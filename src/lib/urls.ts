export function pathFor(path = '') { return `${import.meta.env.BASE_URL.replace(/\/$/,'')}/${path.replace(/^\//,'')}`; }
export function safeJson(value:unknown) { return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'); }
