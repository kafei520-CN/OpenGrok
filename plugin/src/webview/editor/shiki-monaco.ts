import bash from '@shikijs/langs/bash';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import csharp from '@shikijs/langs/csharp';
import css from '@shikijs/langs/css';
import dart from '@shikijs/langs/dart';
import diff from '@shikijs/langs/diff';
import docker from '@shikijs/langs/dockerfile';
import go from '@shikijs/langs/go';
import graphql from '@shikijs/langs/graphql';
import html from '@shikijs/langs/html';
import ini from '@shikijs/langs/ini';
import java from '@shikijs/langs/java';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsonc from '@shikijs/langs/jsonc';
import jsx from '@shikijs/langs/jsx';
import kotlin from '@shikijs/langs/kotlin';
import less from '@shikijs/langs/less';
import lua from '@shikijs/langs/lua';
import markdown from '@shikijs/langs/markdown';
import php from '@shikijs/langs/php';
import powershell from '@shikijs/langs/powershell';
import python from '@shikijs/langs/python';
import ruby from '@shikijs/langs/ruby';
import rust from '@shikijs/langs/rust';
import scss from '@shikijs/langs/scss';
import shellscript from '@shikijs/langs/shellscript';
import sql from '@shikijs/langs/sql';
import swift from '@shikijs/langs/swift';
import toml from '@shikijs/langs/toml';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';
import { shikiToMonaco } from '@shikijs/monaco';
import darkPlus from '@shikijs/themes/dark-plus';
import lightPlus from '@shikijs/themes/light-plus';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

type MonacoApi = {
  editor: {
    defineTheme: (name: string, theme: unknown) => void;
    setTheme: (name: string) => void;
    create: (...args: unknown[]) => unknown;
  };
  languages: {
    getLanguages: () => Array<{ id: string }>;
    register: (lang: { id: string }) => void;
    setTokensProvider: (id: string, provider: unknown) => void;
  };
};

declare global {
  interface Window {
    monaco?: MonacoApi;
    __grokShikiReady?: Promise<void>;
    __grokShikiTheme?: (dark: boolean) => string;
  }
}

async function bindShiki(): Promise<void> {
  const monaco = window.monaco;
  if (!monaco) {
    throw new Error('monaco missing');
  }
  const highlighter = await createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [darkPlus, lightPlus],
    langs: [
      bash,
      c,
      cpp,
      csharp,
      css,
      dart,
      diff,
      docker,
      go,
      graphql,
      html,
      ini,
      java,
      javascript,
      json,
      jsonc,
      jsx,
      kotlin,
      less,
      lua,
      markdown,
      php,
      powershell,
      python,
      ruby,
      rust,
      scss,
      shellscript,
      sql,
      swift,
      toml,
      tsx,
      typescript,
      xml,
      yaml,
    ],
  });
  const known = new Set(monaco.languages.getLanguages().map((lang) => lang.id));
  for (const id of highlighter.getLoadedLanguages()) {
    if (!known.has(id)) {
      monaco.languages.register({ id });
      known.add(id);
    }
  }
  shikiToMonaco(highlighter, monaco as never);
  window.__grokShikiTheme = (dark) => (dark ? 'dark-plus' : 'light-plus');
}

window.__grokShikiReady = bindShiki();
