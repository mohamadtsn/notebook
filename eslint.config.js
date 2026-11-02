import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { ScopeManager, Variable } from '@typescript-eslint/scope-manager'

if (ScopeManager && !ScopeManager.prototype.addGlobals) {
  ScopeManager.prototype.addGlobals = function (names) {
    const globalScope = this.scopes[0]
    if (!globalScope) return
    for (const name of names) {
      if (!globalScope.set.has(name)) {
        const variable = new Variable(name, globalScope)
        globalScope.variables.push(variable)
        globalScope.set.set(name, variable)
      }
    }
  }
}

export default defineConfig([
  globalIgnores(['dist', 'server/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: false,
          allowTernary: false,
          allowTaggedTemplates: false,
          enforceForJSX: false,
        },
      ],
    },
  },
])
