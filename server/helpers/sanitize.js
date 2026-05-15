const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'i',
  'u',
  's',
  'strong',
  'em',
  'strike',
  'sub',
  'sup',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'span',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'ins',
  'del',
  'blockquote',
  'pre',
  'code',
  'hr',
];

const ALLOWED_ATTRIBUTES = {
  '*': ['style', 'class', 'dir', 'id'],
  a: ['href', 'target', 'rel'],
  ins: ['data-tc-id', 'data-tc-author', 'data-tc-time'],
  del: ['data-tc-id', 'data-tc-author', 'data-tc-time'],
  span: [
    'data-tc-fmt-id',
    'data-tc-author',
    'data-tc-time',
    'data-tc-fmt-old',
    'data-tc-fmt-new',
    'data-comment-anchor-id',
  ],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

const options = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedSchemes: ['http', 'https', 'mailto'],
  disallowedTagsMode: 'discard',
};

function sanitize(html) {
  if (!html) return html;
  return sanitizeHtml(html, options);
}

module.exports = { sanitize };
