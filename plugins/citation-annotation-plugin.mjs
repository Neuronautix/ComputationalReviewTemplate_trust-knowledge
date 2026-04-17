// citation-annotation-plugin.mjs — MyST plugin for CiTO citation tooltips
// Reads citation context JSONs and builds DOI→annotation lookup for the widget.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const citationAnnotationDirective = {
  name: 'citation-annotations',
  doc: 'Loads citation annotation data and enables hover tooltips on citations.',
  options: {
    'evidence-dir': { type: String },
  },
  run(data) {
    return [{
      type: 'citation-annotations',
      evidenceDir: data.options?.['evidence-dir'] || '../evidence',
    }];
  },
};

const citationAnnotationTransform = {
  name: 'citation-annotation-loader',
  stage: 'document',
  plugin: (opts, utils) => (tree, vfile) => {
    function transform(node) {
      if (!node) return;
      if (node.type === 'citation-annotations') {
        const docDir = vfile?.path ? dirname(vfile.path) : process.cwd();
        const evidenceDir = resolve(docDir, node.evidenceDir || '../evidence');
        try {
          const annotations = {};
          let files;
          try {
            files = readdirSync(evidenceDir).filter(f => f.includes('citation_context'));
          } catch (e) { files = []; }

          for (const file of files) {
            try {
              const raw = readFileSync(resolve(evidenceDir, file), 'utf-8');
              const entries = JSON.parse(raw);
              if (Array.isArray(entries)) {
                for (const entry of entries) {
                  const doi = entry.doi;
                  if (doi && !annotations[doi]) {
                    annotations[doi] = {
                      cito: entry.cito || 'cites',
                      role: entry.role || '',
                      claim: (entry.claim_attributed || '').slice(0, 300),
                      source: (entry.source_sentence || '').slice(0, 300),
                      agreement: entry.agreement || '',
                      cite_key: entry.cite_key || '',
                    };
                  }
                }
              }
            } catch (e) { /* skip */ }
          }

          node.type = 'anywidget';
          node.id = 'citation-annotations-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          node.esm = './citation-annotation-widget.mjs';
          node.model = {
            annotation_data: JSON.stringify(annotations),
          };
        } catch (err) {
          node.type = 'paragraph';
          node.children = [];
        }
      }
      if (node.children) {
        for (const child of node.children) transform(child);
      }
    }
    transform(tree);
  },
};

export default {
  name: 'Citation Annotation Plugin',
  directives: [citationAnnotationDirective],
  transforms: [citationAnnotationTransform],
};
