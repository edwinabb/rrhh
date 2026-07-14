/** Contra Postgres real (docker-compose) — RLS y vistas no se pueden verificar con mocks. */
module.exports = {
  rootDir: 'test/integration',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testRegex: '.*\\.integration-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testTimeout: 30000,
};
