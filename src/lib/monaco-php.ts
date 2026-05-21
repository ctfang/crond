import { Monaco } from '@monaco-editor/react';

export const registerPhpCompletion = (monaco: Monaco) => {
  if ((window as any).__phpCompletionRegistered) return;

  const keywords = [
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone',
    'const', 'continue', 'declare', 'default', 'die', 'do', 'echo', 'else', 'elseif', 'empty',
    'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'eval', 'exit',
    'extends', 'final', 'finally', 'for', 'foreach', 'function', 'global', 'goto', 'if',
    'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset',
    'list', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'require',
    'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use',
    'var', 'while', 'xor', 'yield', '__halt_compiler', '__CLASS__', '__DIR__', '__FILE__',
    '__FUNCTION__', '__LINE__', '__METHOD__', '__NAMESPACE__', '__TRAIT__'
  ];

  const builtInFunctions = [
    'abs', 'array_filter', 'array_map', 'array_merge', 'array_push', 'array_pop', 'array_keys',
    'array_values', 'count', 'date', 'define', 'defined', 'explode', 'file_get_contents',
    'file_put_contents', 'header', 'implode', 'is_array', 'is_null', 'is_string', 'json_decode',
    'json_encode', 'max', 'min', 'phpinfo', 'preg_match', 'preg_replace', 'print_r', 'rand',
    'round', 'sprintf', 'str_replace', 'strlen', 'strtolower', 'strtoupper', 'substr', 'time',
    'trim', 'var_dump'
  ];

  monaco.languages.registerCompletionItemProvider('php', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: any[] = [
        ...keywords.map(k => ({
          label: k,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: k,
          range: range,
        })),
        ...builtInFunctions.map(f => ({
          label: f,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${f}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: range,
        })),
        // Snippets
        {
          label: 'pubf',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'public function ${1:name}(${2:$args})\n{\n\t${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Public function',
          range: range,
        },
        {
          label: 'prof',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'protected function ${1:name}(${2:$args})\n{\n\t${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Protected function',
          range: range,
        },
        {
          label: 'prif',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'private function ${1:name}(${2:$args})\n{\n\t${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Private function',
          range: range,
        },
        {
          label: 'fore',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'foreach (${1:$array} as ${2:$item}) {\n\t${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'foreach loop',
          range: range,
        },
        {
            label: 'forek',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'foreach (${1:$array} as ${2:$key} => ${3:$value}) {\n\t${0}\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: 'foreach loop (key => value)',
            range: range,
        },
        {
          label: 'if',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'if (${1:condition}) {\n\t${0}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: range,
        },
        {
            label: 'ifelse',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${0}\n}',
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range,
        },
        {
          label: 'class',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'class ${1:ClassName}\n{\n\tpublic function __construct(${2})\n\t{\n\t\t${3}\n\t}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: range,
        }
      ];

      return { suggestions: suggestions };
    },
  });

  (window as any).__phpCompletionRegistered = true;
};
