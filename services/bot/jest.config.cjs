module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  clearMocks: true
};
