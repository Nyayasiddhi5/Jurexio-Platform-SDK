/**
 * eslint-rules/no-mock-data.js
 *
 * Custom ESLint rule that bans mock/fake/sample data identifiers in
 * production page files (client/src/pages/**). Catches:
 *   const fakeData = [...]
 *   const MOCK_DATA = {...}
 *   const sampleData = ...
 *   const FAKE_USERS = ...
 *   class MockDataProvider { ... }
 *
 * Loaded as a custom plugin via `.eslintrc.json` → `rulePaths` /
 * `plugins`. See `.eslintrc.json` overrides[] for the actual wiring.
 */

'use strict';

const BANNED = /^(MockData|MOCK_DATA|fakeData|FAKE_|sampleData)/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow mock/fake/sample data identifiers in client/src/pages/** — pages must call real APIs.',
      recommended: false,
    },
    schema: [],
    messages: {
      banned:
        "Identifier '{{name}}' looks like mock/fake/sample data and is banned in pages. Use a real API call instead.",
    },
  },
  create(context) {
    function check(node, name) {
      if (typeof name !== 'string') return;
      if (BANNED.test(name)) {
        context.report({ node, messageId: 'banned', data: { name } });
      }
    }
    return {
      VariableDeclarator(node) {
        if (node.id && node.id.type === 'Identifier') check(node.id, node.id.name);
      },
      FunctionDeclaration(node) {
        if (node.id) check(node.id, node.id.name);
      },
      ClassDeclaration(node) {
        if (node.id) check(node.id, node.id.name);
      },
      Property(node) {
        if (node.key && node.key.type === 'Identifier') check(node.key, node.key.name);
      },
    };
  },
};
