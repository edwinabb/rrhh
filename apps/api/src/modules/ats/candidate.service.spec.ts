import { CandidateService } from './candidate.service';

/**
 * Tests unitarios de CandidateService (ATS, Fase 4).
 * Los métodos reciben el tx de Prisma como parámetro y aquí se mockea por
 * completo — sin BD real. Cubre: consentimiento LPDP (Ley 29733), vacante
 * ABIERTA, email único por vacante, máquina de estados y contratación
 * (vínculo con Employee, D.Leg. 728).
 */
describe('CandidateService', () => {
  const TENANT = 'tenant-1';
  const VACANTE = 'vac-1';
  const AUTOR = 'user-1';

  const vacanteAbierta = {
    id: VACANTE,
    tenantId: TENANT,
    titulo: 'Desarrollador Senior',
    estado: 'ABIERTA',
  };

  const candidatoAplicado = {
    id: 'cand-1',
    tenantId: TENANT,
    vacanteId: VACANTE,
    nombreCompleto: 'Juan Pérez',
    email: 'juan@example.com',
    estado: 'APLICADO',
    consentimientoLpdp: true,
    employeeId: null,
  };

  const inputValido = {
    tenantId: TENANT,
    vacanteId: VACANTE,
    nombreCompleto: 'Juan Pérez',
    email: 'Juan@Example.com',
    telefono: '+51 999 888 777',
    cvRutaMinio: 'tenant-1/cv/juan.pdf',
    consentimientoLpdp: true,
  };

  function buildTx(overrides: Partial<Record<string, any>> = {}) {
    return {
      vacante: {
        findUnique: jest.fn().mockResolvedValue(vacanteAbierta),
      },
      candidato: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'cand-nuevo', ...data })),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) =>
            Promise.resolve({ ...candidatoAplicado, id: where.id, ...data }),
          ),
      },
      candidatoNota: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'nota-1', ...data })),
      },
      ...overrides,
    };
  }

  const service = new CandidateService();

  describe('registrarCandidato', () => {
    it('registra al candidato con estado APLICADO y email normalizado a minúsculas', async () => {
      const tx = buildTx();

      const candidato = await service.registrarCandidato(tx, inputValido);

      expect(tx.candidato.create).toHaveBeenCalledTimes(1);
      const data = (tx.candidato.create as jest.Mock).mock.calls[0][0].data;
      expect(data.estado).toBe('APLICADO');
      expect(data.email).toBe('juan@example.com');
      expect(data.consentimientoLpdp).toBe(true);
      expect(candidato.id).toBe('cand-nuevo');
    });

    it('rechaza el registro sin consentimiento LPDP (Ley 29733)', async () => {
      const tx = buildTx();

      await expect(
        service.registrarCandidato(tx, { ...inputValido, consentimientoLpdp: false }),
      ).rejects.toThrow(/consentimiento/i);
      expect(tx.candidato.create).not.toHaveBeenCalled();
    });

    it('rechaza el registro en una vacante CERRADA', async () => {
      const tx = buildTx({
        vacante: {
          findUnique: jest.fn().mockResolvedValue({ ...vacanteAbierta, estado: 'CERRADA' }),
        },
      });

      await expect(service.registrarCandidato(tx, inputValido)).rejects.toThrow(/ABIERTA/);
      expect(tx.candidato.create).not.toHaveBeenCalled();
    });

    it('rechaza el registro si la vacante no existe', async () => {
      const tx = buildTx({
        vacante: { findUnique: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.registrarCandidato(tx, inputValido)).rejects.toThrow(
        /no encontrada/i,
      );
    });

    it('rechaza un email duplicado en la misma vacante', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado);

      await expect(service.registrarCandidato(tx, inputValido)).rejects.toThrow(/ya.*postul/i);
      expect(tx.candidato.findUnique).toHaveBeenCalledWith({
        where: {
          vacanteId_email: { vacanteId: VACANTE, email: 'juan@example.com' },
        },
      });
      expect(tx.candidato.create).not.toHaveBeenCalled();
    });
  });

  describe('cambiarEstado', () => {
    it('permite la transición válida APLICADO → REVISADO', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado);

      const actualizado = await service.cambiarEstado(tx, 'cand-1', 'REVISADO');

      expect(tx.candidato.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: { estado: 'REVISADO' },
      });
      expect(actualizado.estado).toBe('REVISADO');
    });

    it('rechaza una transición inválida (APLICADO → OFERTA)', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado);

      await expect(service.cambiarEstado(tx, 'cand-1', 'OFERTA')).rejects.toThrow(
        /transici[oó]n/i,
      );
      expect(tx.candidato.update).not.toHaveBeenCalled();
    });

    it('permite RECHAZADO desde cualquier estado no terminal (p. ej. ENTREVISTA)', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue({
        ...candidatoAplicado,
        estado: 'ENTREVISTA',
      });

      const actualizado = await service.cambiarEstado(tx, 'cand-1', 'RECHAZADO');

      expect(actualizado.estado).toBe('RECHAZADO');
    });

    it('rechaza transiciones desde estados terminales (RECHAZADO, CONTRATADO)', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue({
        ...candidatoAplicado,
        estado: 'CONTRATADO',
      });

      await expect(service.cambiarEstado(tx, 'cand-1', 'RECHAZADO')).rejects.toThrow(
        /transici[oó]n/i,
      );
    });

    it('lanza si el candidato no existe', async () => {
      const tx = buildTx();

      await expect(service.cambiarEstado(tx, 'no-existe', 'REVISADO')).rejects.toThrow(
        /no encontrado/i,
      );
    });
  });

  describe('agregarNota', () => {
    it('crea la nota vinculada al candidato con su autor y tenant', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado);

      const nota = await service.agregarNota(tx, 'cand-1', AUTOR, 'Buen perfil técnico');

      expect(tx.candidatoNota.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          candidatoId: 'cand-1',
          autorId: AUTOR,
          nota: 'Buen perfil técnico',
        },
      });
      expect(nota.id).toBe('nota-1');
    });

    it('rechaza una nota vacía', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado);

      await expect(service.agregarNota(tx, 'cand-1', AUTOR, '   ')).rejects.toThrow(/nota/i);
      expect(tx.candidatoNota.create).not.toHaveBeenCalled();
    });
  });

  describe('contratar', () => {
    it('pasa de OFERTA a CONTRATADO y vincula el employeeId (D.Leg. 728)', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue({
        ...candidatoAplicado,
        estado: 'OFERTA',
      });

      const contratado = await service.contratar(tx, 'cand-1', 'emp-99');

      expect(tx.candidato.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: { estado: 'CONTRATADO', employeeId: 'emp-99' },
      });
      expect(contratado.estado).toBe('CONTRATADO');
      expect(contratado.employeeId).toBe('emp-99');
    });

    it('lanza si el candidato no está en OFERTA', async () => {
      const tx = buildTx();
      (tx.candidato.findUnique as jest.Mock).mockResolvedValue(candidatoAplicado); // APLICADO

      await expect(service.contratar(tx, 'cand-1', 'emp-99')).rejects.toThrow(/OFERTA/);
      expect(tx.candidato.update).not.toHaveBeenCalled();
    });
  });
});
