import { Inject, Injectable, Optional } from '@nestjs/common';

/**
 * Fase 4 — ATS: parsing de CVs con Claude API.
 *
 * El cliente LLM está detrás de una interfaz inyectable (patrón
 * BIOMETRIC_PROVIDER) para poder mockearlo en tests: sin red real.
 */

/** Opciones por llamada al LLM. */
export interface LlmCompleteOptions {
  maxTokens?: number;
}

/**
 * Contrato que debe cumplir cualquier cliente LLM.
 * En tests se usa un mock; en producción, AnthropicLlmClient.
 */
export interface LlmClient {
  complete(prompt: string, opciones?: LlmCompleteOptions): Promise<string>;
}

/** Token de inyección para el cliente LLM activo. */
export const LLM_CLIENT = 'LLM_CLIENT';

/** Opciones de construcción del conector real. */
export interface AnthropicLlmClientOptions {
  /** API key; por defecto se lee de process.env.ANTHROPIC_API_KEY al llamar. */
  apiKey?: string;
  /** Modelo Claude; por defecto claude-opus-4-8. */
  modelo?: string;
  /** max_tokens por defecto (2048 si no se indica). */
  maxTokens?: number;
  /** fetch inyectable para tests; por defecto el fetch global. */
  fetchFn?: typeof fetch;
}

/**
 * Conector real a la Claude API (sin SDK — regla 9):
 * POST https://api.anthropic.com/v1/messages con x-api-key + anthropic-version.
 * NO se testea contra red real: en tests se inyecta fetchFn mock.
 */
@Injectable()
export class AnthropicLlmClient implements LlmClient {
  private static readonly API_URL = 'https://api.anthropic.com/v1/messages';
  private static readonly API_VERSION = '2023-06-01';
  private static readonly MODELO_DEFAULT = 'claude-opus-4-8';
  private static readonly MAX_TOKENS_DEFAULT = 2048;

  constructor(private readonly opciones: AnthropicLlmClientOptions = {}) {}

  async complete(prompt: string, opciones?: LlmCompleteOptions): Promise<string> {
    const apiKey = this.opciones.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY no configurada: define la variable de entorno o pasa apiKey al constructor',
      );
    }

    const fetchFn = this.opciones.fetchFn ?? fetch;
    const respuesta = await fetchFn(AnthropicLlmClient.API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': AnthropicLlmClient.API_VERSION,
      },
      body: JSON.stringify({
        model: this.opciones.modelo ?? AnthropicLlmClient.MODELO_DEFAULT,
        max_tokens:
          opciones?.maxTokens ??
          this.opciones.maxTokens ??
          AnthropicLlmClient.MAX_TOKENS_DEFAULT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '');
      throw new Error(`Claude API respondió ${respuesta.status}: ${cuerpo}`);
    }

    const data = (await respuesta.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };

    if (data.stop_reason === 'refusal') {
      throw new Error('Claude API rechazó la solicitud (stop_reason: refusal)');
    }

    return (data.content ?? [])
      .filter((bloque) => bloque.type === 'text' && typeof bloque.text === 'string')
      .map((bloque) => bloque.text as string)
      .join('');
  }
}

// ---------------------------------------------------------------------------
// Tipos del resultado de parsing
// ---------------------------------------------------------------------------

export interface ExperienciaCv {
  empresa: string;
  cargo: string;
  /** Fecha inicio (YYYY-MM-DD) o null si no se pudo determinar. */
  desde: string | null;
  /** Fecha fin (YYYY-MM-DD) o null si es el puesto actual / desconocida. */
  hasta: string | null;
}

export interface FormacionCv {
  institucion: string;
  titulo: string;
  anio: number | null;
}

export interface CvParseado {
  nombreCompleto: string;
  email: string | null;
  telefono: string | null;
  experiencia: ExperienciaCv[];
  habilidades: string[];
  formacion: FormacionCv[];
  idiomas: string[];
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** El LLM devolvió algo que no pudo interpretarse como un CV válido. */
export class CvParseError extends Error {
  constructor(
    mensaje: string,
    /** Detalle técnico (qué falló y fragmento de la respuesta). */
    public readonly detalle: string,
  ) {
    super(mensaje);
    this.name = 'CvParseError';
  }
}

/** Se excedió el máximo de parseos por hora para el tenant. */
export class CvRateLimitError extends Error {
  constructor(tenantId: string, maxPorHora: number) {
    super(
      `Límite de parsing de CVs excedido para el tenant ${tenantId}: máximo ${maxPorHora} por hora`,
    );
    this.name = 'CvRateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

export interface CvParsingOptions {
  /** Máximo de parseos por tenant por hora (default 100). */
  maxPorHora?: number;
}

interface VentanaRateLimit {
  inicioMs: number;
  contador: number;
}

/**
 * Orquesta la extracción estructurada de datos de un CV vía LLM:
 * construye el prompt, tolera fences de markdown en la respuesta,
 * valida campos mínimos y aplica rate limiting simple en memoria por tenant.
 */
@Injectable()
export class CVParsingService {
  private static readonly MAX_POR_HORA_DEFAULT = 100;
  private static readonly VENTANA_MS = 60 * 60 * 1000;
  private static readonly MAX_DETALLE_RESPUESTA = 300;

  private readonly llm: LlmClient;
  private readonly maxPorHora: number;
  private readonly ventanas = new Map<string, VentanaRateLimit>();

  constructor(
    @Inject(LLM_CLIENT) llm: LlmClient,
    @Optional() opciones?: CvParsingOptions,
  ) {
    this.llm = llm;
    this.maxPorHora = opciones?.maxPorHora ?? CVParsingService.MAX_POR_HORA_DEFAULT;
  }

  /**
   * Parsea el texto plano de un CV y retorna los datos estructurados.
   *
   * @param tenantId tenant que solicita el parsing (para rate limiting)
   * @param textoCv  texto plano extraído del CV (PDF/DOCX/TXT ya convertido)
   * @param idioma   idioma esperado del CV / de la respuesta (default 'es')
   */
  async parsearCv(tenantId: string, textoCv: string, idioma = 'es'): Promise<CvParseado> {
    this.verificarRateLimit(tenantId);

    const prompt = this.construirPrompt(textoCv, idioma);
    const respuesta = await this.llm.complete(prompt);
    const json = this.extraerJson(respuesta);
    return this.validarYNormalizar(json, respuesta);
  }

  // -- Rate limiting ---------------------------------------------------------

  private verificarRateLimit(tenantId: string): void {
    const ahora = Date.now();
    const ventana = this.ventanas.get(tenantId);

    if (!ventana || ahora - ventana.inicioMs >= CVParsingService.VENTANA_MS) {
      this.ventanas.set(tenantId, { inicioMs: ahora, contador: 1 });
      return;
    }

    if (ventana.contador >= this.maxPorHora) {
      throw new CvRateLimitError(tenantId, this.maxPorHora);
    }
    ventana.contador += 1;
  }

  // -- Prompt ----------------------------------------------------------------

  private construirPrompt(textoCv: string, idioma: string): string {
    return [
      'Eres un experto en parsing de CVs (currículums).',
      `El CV está escrito principalmente en el idioma "${idioma}"; responde los valores textuales en ese mismo idioma.`,
      'Analiza el CV a continuación y extrae la información estructurada.',
      '',
      'Retorna ÚNICAMENTE un JSON válido (sin markdown, sin explicaciones) con exactamente esta estructura:',
      '{',
      '  "nombreCompleto": "string",',
      '  "email": "string o null",',
      '  "telefono": "string o null",',
      '  "experiencia": [',
      '    { "empresa": "string", "cargo": "string", "desde": "YYYY-MM-DD o null", "hasta": "YYYY-MM-DD o null" }',
      '  ],',
      '  "habilidades": ["string"],',
      '  "formacion": [',
      '    { "institucion": "string", "titulo": "string", "anio": number }',
      '  ],',
      '  "idiomas": ["string"]',
      '}',
      '',
      'Si un dato no aparece en el CV usa null (para strings/fechas) o [] (para listas). No inventes datos.',
      '',
      'CV a procesar:',
      '---',
      textoCv,
      '---',
    ].join('\n');
  }

  // -- Parsing de la respuesta -----------------------------------------------

  /**
   * Extrae el objeto JSON de la respuesta del LLM, tolerando fences de
   * markdown (```json ... ```) y prosa alrededor del objeto.
   */
  private extraerJson(respuesta: string): unknown {
    let texto = respuesta.trim();

    const fence = texto.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence?.[1] !== undefined) {
      texto = fence[1].trim();
    }

    if (!texto.startsWith('{')) {
      const inicio = texto.indexOf('{');
      const fin = texto.lastIndexOf('}');
      if (inicio === -1 || fin <= inicio) {
        throw new CvParseError(
          'CV no válido o el LLM no pudo procesarlo',
          `La respuesta no contiene un objeto JSON: "${this.recortar(respuesta)}"`,
        );
      }
      texto = texto.slice(inicio, fin + 1);
    }

    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new CvParseError(
        'CV no válido o el LLM no pudo procesarlo',
        `JSON inválido (${motivo}) en la respuesta: "${this.recortar(respuesta)}"`,
      );
    }

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new CvParseError(
        'CV no válido o el LLM no pudo procesarlo',
        `La raíz del JSON no es un objeto: "${this.recortar(respuesta)}"`,
      );
    }
    return json;
  }

  // -- Validación y normalización --------------------------------------------

  private validarYNormalizar(json: unknown, respuesta: string): CvParseado {
    const datos = json as Record<string, unknown>;

    const nombreCompleto = this.comoStringONull(datos.nombreCompleto);
    if (!nombreCompleto) {
      throw new CvParseError(
        'CV no válido o el LLM no pudo procesarlo',
        `Falta el campo mínimo "nombreCompleto" en la respuesta: "${this.recortar(respuesta)}"`,
      );
    }

    const email = this.comoStringONull(datos.email);
    const telefono = this.comoStringONull(datos.telefono);
    if (!email && !telefono) {
      throw new CvParseError(
        'CV no válido o el LLM no pudo procesarlo',
        `Se requiere al menos "email" o "telefono"; ambos ausentes en: "${this.recortar(respuesta)}"`,
      );
    }

    return {
      nombreCompleto,
      email,
      telefono,
      experiencia: this.normalizarExperiencia(datos.experiencia),
      habilidades: this.normalizarStrings(datos.habilidades),
      formacion: this.normalizarFormacion(datos.formacion),
      idiomas: this.normalizarStrings(datos.idiomas),
    };
  }

  private normalizarExperiencia(valor: unknown): ExperienciaCv[] {
    if (!Array.isArray(valor)) return [];
    return valor
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        empresa: this.comoStringONull(item.empresa) ?? '',
        cargo: this.comoStringONull(item.cargo) ?? '',
        desde: this.comoStringONull(item.desde),
        hasta: this.comoStringONull(item.hasta),
      }));
  }

  private normalizarFormacion(valor: unknown): FormacionCv[] {
    if (!Array.isArray(valor)) return [];
    return valor
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => ({
        institucion: this.comoStringONull(item.institucion) ?? '',
        titulo: this.comoStringONull(item.titulo) ?? '',
        anio: typeof item.anio === 'number' && Number.isFinite(item.anio) ? item.anio : null,
      }));
  }

  private normalizarStrings(valor: unknown): string[] {
    if (!Array.isArray(valor)) return [];
    return valor.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }

  private comoStringONull(valor: unknown): string | null {
    return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
  }

  private recortar(texto: string): string {
    const limpio = texto.replace(/\s+/g, ' ').trim();
    return limpio.length <= CVParsingService.MAX_DETALLE_RESPUESTA
      ? limpio
      : `${limpio.slice(0, CVParsingService.MAX_DETALLE_RESPUESTA)}…`;
  }
}
