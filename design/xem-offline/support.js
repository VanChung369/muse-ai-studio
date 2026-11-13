/*
 * MUSE2API offline runtime — chạy các artboard .dc.html trực tiếp trên trình duyệt,
 * không cần canvas Design. Hỗ trợ đúng phần cú pháp các board dùng:
 * {{ path }}, <sc-for list as>, <sc-if value>, onClick / onChange, class Component extends DCLogic.
 * Chỉ dùng cho bản xem offline. KHÔNG upload file này lên canvas.
 */
(function () {
  'use strict';

  // Toàn bộ phần sau thẻ <script> này được trình duyệt đọc như văn bản thô,
  // để <sc-for> nằm trong <table> không bị parser HTML đẩy ra ngoài bảng.
  document.write('<plaintext style="display:none">');

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var BOOL = { checked: 1, disabled: 1, selected: 1, hidden: 1, readonly: 1, multiple: 1 };
  var inst = null, tplRoot = null, mount = null, pending = false;

  function DCLogic(props) { this.props = props || {}; this.state = null; }
  DCLogic.prototype.setState = function (p, cb) {
    var prev = this.state || {};
    var upd = typeof p === 'function' ? p(prev, this.props) : p;
    this.state = Object.assign({}, prev, upd || {});
    schedule();
    if (cb) Promise.resolve().then(cb);
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function resolve(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
    if (/^'.*'$|^".*"$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function str(v) { return v == null ? '' : String(v); }
  function interp(s, scope) { return s.replace(HOLE, function (_, e) { return str(resolve(e, scope)); }); }
  function evalAttr(s, scope) { var m = WHOLE.exec(s || ''); return m ? resolve(m[1], scope) : interp(s || '', scope); }

  function renderChildren(parent, scope, out) {
    var kids = parent.childNodes;
    for (var i = 0; i < kids.length; i++) renderNode(kids[i], scope, out);
  }

  function renderNode(n, scope, out) {
    if (n.nodeType === 3) {
      var t = n.nodeValue;
      out.appendChild(document.createTextNode(t.indexOf('{{') < 0 ? t : interp(t, scope)));
      return;
    }
    if (n.nodeType !== 1) return;
    var tag = n.localName;
    if (tag === 'template' && n.hasAttribute('data-for')) {
      var list = evalAttr(n.getAttribute('list'), scope) || [];
      var as = n.getAttribute('as') || 'item';
      for (var i = 0; i < list.length; i++) {
        var s = Object.create(scope);
        s[as] = list[i];
        s.$index = i;
        renderChildren(n.content, s, out);
      }
      return;
    }
    if (tag === 'template' && n.hasAttribute('data-if')) {
      if (evalAttr(n.getAttribute('value'), scope)) renderChildren(n.content, scope, out);
      return;
    }
    var el = document.importNode(n, false);
    var attrs = Array.prototype.slice.call(n.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, val = attrs[a].value;
      if (val.indexOf('{{') < 0) continue;
      var whole = WHOLE.exec(val);
      if (name.indexOf('on') === 0 && whole) {
        el.removeAttribute(name);
        el.__h = el.__h || {};
        el.__h[name.slice(2)] = resolve(whole[1], scope);
        continue;
      }
      var v = whole ? resolve(whole[1], scope) : interp(val, scope);
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
        el.removeAttribute('value');
        el.__value = str(v);
        if (tag === 'input') el.setAttribute('value', str(v));
      } else if (BOOL[name]) {
        if (v === true || v === 'true') el.setAttribute(name, ''); else el.removeAttribute(name);
      } else {
        el.setAttribute(name, str(v));
      }
    }
    renderChildren(n, scope, el);
    if (el.__value !== undefined) el.value = el.__value;
    if (tag === 'input' && el.hasAttribute('checked')) el.checked = true;
    out.appendChild(el);
  }

  function morph(from, to) {
    var fa = Array.prototype.slice.call(from.attributes), i;
    for (i = 0; i < fa.length; i++) if (!to.hasAttribute(fa[i].name)) from.removeAttribute(fa[i].name);
    var ta = to.attributes;
    for (i = 0; i < ta.length; i++) if (from.getAttribute(ta[i].name) !== ta[i].value) from.setAttribute(ta[i].name, ta[i].value);
    from.__h = to.__h;
    if (to.__value !== undefined) {
      if (from !== document.activeElement && from.value !== to.__value) from.value = to.__value;
      from.__value = to.__value;
    }
    if (to.localName === 'input' && (to.type === 'checkbox' || to.type === 'radio')) from.checked = to.hasAttribute('checked');
    morphChildren(from, to);
  }

  function morphChildren(fp, tp) {
    var f = fp.firstChild, t = tp.firstChild;
    while (t) {
      var tn = t.nextSibling;
      if (!f) {
        fp.appendChild(t);
      } else if (f.nodeType === t.nodeType && (f.nodeType !== 1 || f.localName === t.localName)) {
        if (f.nodeType === 1) morph(f, t);
        else if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue;
        f = f.nextSibling;
      } else {
        fp.insertBefore(t, f);
      }
      t = tn;
    }
    while (f) { var fn = f.nextSibling; fp.removeChild(f); f = fn; }
  }

  function render() {
    var vals;
    try { vals = inst.renderVals() || {}; }
    catch (err) { console.error('[dc offline] renderVals lỗi:', err); return; }
    var next = document.createElement('div');
    renderChildren(tplRoot, vals, next);
    morphChildren(mount, next);
  }

  function dispatch(type, e) {
    var n = e.target;
    while (n && n !== document) {
      var h = n.__h && n.__h[type];
      if (typeof h === 'function') h(e);
      if (e.cancelBubble) break;
      n = n.parentNode;
    }
  }

  function decode(s) {
    var ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  function boot() {
    var pt = document.querySelector('plaintext');
    if (!pt) return;
    var src = pt.textContent;
    pt.parentNode.removeChild(pt);

    var body = (/<x-dc>([\s\S]*)<\/x-dc>/.exec(src) || [])[1] || '';
    var sm = /<script\s+type="text\/x-dc"([^>]*)>([\s\S]*?)<\/script>/.exec(src);
    body = body.replace(/<sc-for\b/g, '<template data-for').replace(/<\/sc-for>/g, '</template>')
               .replace(/<sc-if\b/g, '<template data-if').replace(/<\/sc-if>/g, '</template>');

    var holder = document.createElement('template');
    holder.innerHTML = body;
    tplRoot = holder.content;
    var helmet = tplRoot.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.childNodes).forEach(function (c) {
        if (c.nodeType === 1) document.head.appendChild(document.importNode(c, true));
      });
      helmet.parentNode.removeChild(helmet);
    }

    var props = {};
    if (sm) {
      var pm = /data-props='([^']*)'/.exec(sm[1]);
      if (pm) {
        try {
          var def = JSON.parse(decode(pm[1]));
          Object.keys(def).forEach(function (k) { if (k.charAt(0) !== '$' && def[k] && 'default' in def[k]) props[k] = def[k]['default']; });
        } catch (err) { console.warn('[dc offline] data-props không đọc được', err); }
      }
    }
    var Component;
    try { Component = new Function('DCLogic', (sm ? sm[2] : 'class Component extends DCLogic { renderVals(){ return {}; } }') + '\n;return Component;')(DCLogic); }
    catch (err) { console.error('[dc offline] script lỗi:', err); return; }
    inst = new Component(props);
    if (!inst.props) inst.props = props;

    mount = document.createElement('div');
    mount.setAttribute('data-dc-root', '');
    document.body.appendChild(mount);
    mount.addEventListener('click', function (e) { dispatch('click', e); });
    mount.addEventListener('input', function (e) {
      if (e.target.matches('input:not([type=checkbox]):not([type=radio]), textarea')) dispatch('change', e);
      dispatch('input', e);
    });
    mount.addEventListener('change', function (e) {
      if (e.target.matches('select, input[type=checkbox], input[type=radio]')) dispatch('change', e);
    });
    render();
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (typeof inst.componentWillUnmount === 'function') inst.componentWillUnmount(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
