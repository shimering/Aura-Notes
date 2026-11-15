import createDOMPurify from 'dompurify';
import { pictureWraps } from './pageObjects';

const tags = [
  'p', 'div', 'br', 'hr', 'span', 'font', 'b', 'strong', 'i', 'em', 'u', 's',
  'strike', 'del', 'mark', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'pre', 'code', 'sub', 'sup', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
];
const imageData = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/]+={0,2}$/i;
export const pdfData = /^data:application\/pdf;base64,[a-z0-9+/]+={0,2}$/i;
const colorValue = /^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?)\([0-9.,%\s+/-]+\))$/i;
const decorationValue = /^(?:none|underline|line-through)(?: (?:underline|line-through))*$/;
const formattingStyles = {
  color: colorValue,
  'background-color': colorValue,
  'font-weight': /^(?:normal|bold|[1-9]00)$/,
  'font-style': /^(?:normal|italic|oblique)$/,
  'font-family': /^(?:[a-z\s"'-]+,\s*)*[a-z\s"'-]+$/i,
  'font-size': /^(?:\d{1,3}(?:\.\d+)?(?:px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large)$/,
  'text-align': /^(?:left|right|center|justify|start|end)$/,
  'margin-left': /^(?:0|[1-9]\d{0,2}px)$/,
  'margin-right': /^(?:0|[1-9]\d{0,2}px)$/,
  'text-decoration': decorationValue,
  'text-decoration-line': decorationValue,
};
const positionStyles = {
  left: /^-?\d{1,5}px$/,
  top: /^-?\d{1,5}px$/,
};
const pictureStyles = {
  ...positionStyles,
  width: /^[1-9]\d{0,3}px$/,
  rotate: /^-?\d{1,3}(?:\.\d{1,3})?deg$/,
};
let purifier: ReturnType<typeof createDOMPurify> | undefined;

export function sanitizeNoteHtml(html: string): string {
  // Node-only storage tests have no renderer. Every browser sink also sanitizes.
  if (typeof window === 'undefined') return html;
  if (!purifier) {
    purifier = createDOMPurify(window);
    purifier.addHook('uponSanitizeAttribute', (node, attribute) => {
      if (attribute.attrName === 'src') {
        attribute.keepAttr = node.nodeName === 'IMG' && imageData.test(attribute.attrValue);
      } else if (attribute.attrName === 'href') {
        attribute.keepAttr = node.nodeName === 'A' && pdfData.test(attribute.attrValue);
      } else if (attribute.attrName === 'align') {
        attribute.keepAttr = /^(left|right|center|justify)$/.test(attribute.attrValue);
      } else if (attribute.attrName === 'size') {
        attribute.keepAttr = node.nodeName === 'FONT' && /^[1-7]$/.test(attribute.attrValue);
      } else if (attribute.attrName === 'face') {
        attribute.keepAttr = node.nodeName === 'FONT' && formattingStyles['font-family'].test(attribute.attrValue);
      } else if (attribute.attrName === 'color') {
        attribute.keepAttr = colorValue.test(attribute.attrValue.trim());
      } else if (attribute.attrName === 'data-picture-wrap') {
        attribute.keepAttr = node.nodeName === 'IMG' && Object.hasOwn(pictureWraps, attribute.attrValue);
      } else if (attribute.attrName === 'data-note-positioned') {
        attribute.keepAttr = ['P', 'DIV'].includes(node.nodeName) && attribute.attrValue === 'true';
      } else if (attribute.attrName === 'style') {
        const css = node.ownerDocument.createElement('span').style;
        css.cssText = attribute.attrValue;
        const styles = node.nodeName === 'IMG' ? { ...formattingStyles, ...pictureStyles }
          : node.getAttribute('data-note-positioned') === 'true' && ['P', 'DIV'].includes(node.nodeName)
            ? { ...formattingStyles, ...positionStyles } : formattingStyles;
        attribute.attrValue = Object.entries(styles).flatMap(([property, allowed]) => {
          const value = css.getPropertyValue(property);
          return allowed.test(value) ? [`${property}: ${value};`] : [];
        }).join(' ');
        attribute.keepAttr = attribute.attrValue.length > 0;
      }
    });
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeName === 'IMG' && !node.hasAttribute('src')) node.remove();
      if (node.nodeName === 'A' && !node.hasAttribute('href')) node.removeAttribute('download');
    });
  }
  return purifier.isSupported
    ? purifier.sanitize(html, {
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: ['style', 'color', 'start', 'reversed', 'value', 'align', 'size', 'face',
        'src', 'alt', 'href', 'download', 'data-picture-wrap', 'data-note-positioned'],
      ADD_DATA_URI_TAGS: ['a'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    })
    : plainTextToNoteHtml(html);
}

export function plainTextToNoteHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n?|\n/g, '<br>');
}
