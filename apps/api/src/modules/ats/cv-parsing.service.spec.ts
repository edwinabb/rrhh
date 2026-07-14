import {
  AnthropicLlmClient,
  CvParseError,
  CvRateLimitError,
  CVParsingService,
  LlmClient,
} from './cv-parsing.service';

/**
 * Tests unitarios de CVParsingService (Fase 4 — ATS).
 * El cliente LLM se mockea por completo (patrón BIOMETRIC_PROVIDER):
 * sin red real, sin API key real.
 */
describe('CVParsingService', () => {
  const TENANT = 'tenant-1';

  const CV_TEXTO = `Juan Pérez García
Email: juan.perez@example.com | Teléfono: +51 999 888 777
Experiencia: Desarrollador Senior en Acme SAC (2020-2024)
Habilidades: TypeScript, PostgreSQL
Formación: Ing. de Sistemas, UNI, 2019
Idiomas: Español, Inglés`;

  const JSON_VALIDO = {
    nombreCompleto: 'Juan Pérez García',
    email: 'juan.perez@example.com',
    telefono: '+51 999 888 777',
    experiencia: [
      { empresa: 'Acme SAC', cargo: 'Desarrollador Senior', desde: '2020-01-01', hasta: '2024-01-01' },
    ],
    habilidades: ['TypeScript', 'PostgreSQL'],
    formacion: [{ institucion: 'UNI', titulo: 'Ing. de Sistemas', anio: 2019 }],
    idiomas: ['Español', 'Inglés'],
  };

  function buildLlm(respuesta: string): jest.Mocked<LlmClient> {
    return { complete: jest.fn().mockResolvedValue(respuesta) };
  }

  describe('parsearCv — respuesta JSON limpia', () => {
    it('retorna el CV parseado cuando el LLM responde JSON válido', async () => {
      const llm = buildLlm(JSON.stringify(JSON_VALIDO));
      const service = new CVParsingService(llm);

      const resultado = await service.parsearCv(TENANT, CV_TEXTO);

      expect(resultado.nombreCompleto).toBe('Juan Pérez García');
      expect(resultado.email).toBe('juan.perez@example.com');
      expect(resultado.telefono).toBe('+51 999 888 777');
      expect(resultado.experiencia).toHaveLength(1);
      expect(resultado.experiencia[0]).toEqual({
        empresa: 'Acme SAC',
        cargo: 'Desarrollador Senior',
        desde: '2020-01-01',
        hasta: '2024-01-01',
      });
      expect(resultado.habilidades).toEqual(['TypeScript', 'PostgreSQL']);
      expect(resultado.formacion[0]).toEqual({
        institucion: 'UNI',
        titulo: 'Ing. de Sistemas',
        anio: 2019,
      });
      expect(resultado.idiomas).toEqual(['Español', 'Inglés']);
    });

    it('construye un prompt que incluye el texto del CV, el idioma y las claves del JSON esperado', async () => {
      const llm = buildLlm(JSON.stringify(JSON_VALIDO));
      const service = new CVParsingService(llm);

      await service.parsearCv(TENANT, CV_TEXTO, 'en');

      expect(llm.complete).toHaveBeenCalledTimes(1);
      const prompt = llm.complete.mock.calls[0]?.[0] as string;
      expect(prompt).toContain(CV_TEXTO);
      expect(prompt).toContain('en');
      for (const clave of [
        'nombreCompleto',
        'email',
        'telefono',
        'experiencia',
        'empresa',
        'cargo',
        'desde',
        'hasta',
        'habilidades',
        'formacion',
        'institucion',
        'titulo',
        'anio',
        'idiomas',
      ]) {
        expect(prompt).toContain(clave);
      }
    });

    it('normaliza a arrays vacíos las listas ausentes cuando los campos mínimos están presentes', async () => {
      const llm = buildLlm(
        JSON.stringify({ nombreCompleto: 'Ana Solís', email: 'ana@example.com' }),
      );
      const service = new CVParsingService(llm);

      const resultado = await service.parsearCv(TENANT, CV_TEXTO);

      expect(resultado.nombreCompleto).toBe('Ana Solís');
      expect(resultado.experiencia).toEqual([]);
      expect(resultado.habilidades).toEqual([]);
      expect(resultado.formacion).toEqual([]);
      expect(resultado.idiomas).toEqual([]);
    });
  });

  describe('parsearCv — respuesta con fences de markdown', () => {
    it('tolera un bloque ```json ... ```', async () => {
      const llm = buildLlm('```json\n' + JSON.stringify(JSON_VALIDO) + '\n```');
      const service = new CVParsingService(llm);

      const resultado = await service.parsearCv(TENANT, CV_TEXTO);

      expect(resultado.nombreCompleto).toBe('Juan Pérez García');
      expect(resultado.habilidades).toEqual(['TypeScript', 'PostgreSQL']);
    });

    it('tolera texto alrededor del JSON (prosa antes/después)', async () => {
      const llm = buildLlm(
        'Aquí está el resultado:\n```\n' +
          JSON.stringify(JSON_VALIDO) +
          '\n```\nEspero que sea útil.',
      );
      const service = new CVParsingService(llm);

      const resultado = await service.parsearCv(TENANT, CV_TEXTO);

      expect(resultado.nombreCompleto).toBe('Juan Pérez García');
    });
  });

  describe('parsearCv — respuestas inválidas', () => {
    it('lanza CvParseError con detalle si la respuesta no es JSON', async () => {
      const llm = buildLlm('Lo siento, no puedo procesar este CV.');
      const service = new CVParsingService(llm);

      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvParseError);
      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toMatchObject({
        detalle: expect.stringContaining('JSON'),
      });
    });

    it('lanza CvParseError si falta nombreCompleto', async () => {
      const llm = buildLlm(
        JSON.stringify({ email: 'sin.nombre@example.com', telefono: '999' }),
      );
      const service = new CVParsingService(llm);

      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvParseError);
      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toMatchObject({
        detalle: expect.stringContaining('nombreCompleto'),
      });
    });

    it('lanza CvParseError si no hay ni email ni teléfono', async () => {
      const llm = buildLlm(JSON.stringify({ nombreCompleto: 'Juan Pérez' }));
      const service = new CVParsingService(llm);

      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvParseError);
    });

    it('lanza CvParseError si el JSON raíz no es un objeto', async () => {
      const llm = buildLlm('["no", "es", "un", "objeto"]');
      const service = new CVParsingService(llm);

      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvParseError);
    });
  });

  describe('parsearCv — rate limiting en memoria por tenant', () => {
    it('lanza CvRateLimitError al exceder maxPorHora y no llama al LLM de más', async () => {
      const llm = buildLlm(JSON.stringify(JSON_VALIDO));
      const service = new CVParsingService(llm, { maxPorHora: 2 });

      await service.parsearCv(TENANT, CV_TEXTO);
      await service.parsearCv(TENANT, CV_TEXTO);

      await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvRateLimitError);
      expect(llm.complete).toHaveBeenCalledTimes(2);
    });

    it('el contador es independiente por tenant', async () => {
      const llm = buildLlm(JSON.stringify(JSON_VALIDO));
      const service = new CVParsingService(llm, { maxPorHora: 1 });

      await service.parsearCv('tenant-a', CV_TEXTO);
      await expect(service.parsearCv('tenant-a', CV_TEXTO)).rejects.toThrow(CvRateLimitError);

      // Otro tenant no se ve afectado
      await expect(service.parsearCv('tenant-b', CV_TEXTO)).resolves.toMatchObject({
        nombreCompleto: 'Juan Pérez García',
      });
    });

    it('la ventana se reinicia después de una hora', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-14T10:00:00Z'));
      try {
        const llm = buildLlm(JSON.stringify(JSON_VALIDO));
        const service = new CVParsingService(llm, { maxPorHora: 1 });

        await service.parsearCv(TENANT, CV_TEXTO);
        await expect(service.parsearCv(TENANT, CV_TEXTO)).rejects.toThrow(CvRateLimitError);

        jest.setSystemTime(new Date('2026-07-14T11:00:01Z'));
        await expect(service.parsearCv(TENANT, CV_TEXTO)).resolves.toBeDefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

/**
 * Tests del conector real AnthropicLlmClient — con fetch inyectado (mock),
 * sin red real (regla 9: fetch a /v1/messages, modelo claude-opus-4-8).
 */
describe('AnthropicLlmClient', () => {
  function buildFetchOk(bodyJson: unknown): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(bodyJson),
      text: jest.fn().mockResolvedValue(JSON.stringify(bodyJson)),
    });
  }

  it('envía el request correcto a la API de Anthropic y retorna el texto', async () => {
    const fetchMock = buildFetchOk({
      content: [{ type: 'text', text: '{"ok":true}' }],
      stop_reason: 'end_turn',
    });
    const client = new AnthropicLlmClient({ apiKey: 'sk-test', fetchFn: fetchMock as any });

    const texto = await client.complete('hola', { maxTokens: 1024 });

    expect(texto).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.max_tokens).toBe(1024);
    expect(body.messages).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('lanza error si falta la API key (sin constructor ni ANTHROPIC_API_KEY)', async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const client = new AnthropicLlmClient({ fetchFn: jest.fn() as any });
      await expect(client.complete('hola')).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it('lanza error descriptivo cuando la API responde con estado no-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn(),
      text: jest.fn().mockResolvedValue('{"type":"error"}'),
    });
    const client = new AnthropicLlmClient({ apiKey: 'sk-test', fetchFn: fetchMock as any });

    await expect(client.complete('hola')).rejects.toThrow(/429/);
  });

  it('lanza error cuando la respuesta es un rechazo de seguridad (stop_reason refusal)', async () => {
    const fetchMock = buildFetchOk({ content: [], stop_reason: 'refusal' });
    const client = new AnthropicLlmClient({ apiKey: 'sk-test', fetchFn: fetchMock as any });

    await expect(client.complete('hola')).rejects.toThrow(/refusal|rechaz/i);
  });
});
