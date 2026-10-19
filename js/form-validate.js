// Field-by-field form checking for every form on the site.
//
// On submit, each field that is empty or wrong is highlighted and given its own
// message underneath it, the first one is focused, and the form is NOT submitted
// until every field is fixed. A field's message clears as soon as it is corrected.
//
// It is a classic script so it can be dropped into any page, including the pages
// whose own scripts are minified. It listens on the document in the capture phase,
// so it runs before the page's own submit handler and can stop it.
//
// Pages can also flag a field after a server answer (for example "wrong password"):
//   VHMARTForm.setError(inputOrId, 'Incorrect password.')
//   VHMARTForm.clearErrors(form)
// A form that should not be checked (such as a search bar) carries data-no-validate.
(function () {
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function fields(form) {
    return Array.prototype.filter.call(form.elements, function (el) {
      var type = (el.type || '').toLowerCase();
      if (!/^(input|select|textarea)$/i.test(el.tagName)) return false;
      if (el.disabled || type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') return false;
      return true;
    });
  }

  // "Email", "Password" ... taken from the label's own text, not from its controls.
  function labelOf(el) {
    var label = el.labels && el.labels[0];
    var text = '';
    if (label) {
      for (var i = 0; i < label.childNodes.length; i++) {
        if (label.childNodes[i].nodeType === 3) text += label.childNodes[i].nodeValue;
      }
    }
    text = text.replace(/\s+/g, ' ').replace(/[*:]/g, '').trim();
    return text || el.getAttribute('aria-label') || el.name || 'This field';
  }

  function lower(text) { return text.charAt(0).toLowerCase() + text.slice(1); }

  // Returns a message when the field is not acceptable, or '' when it is.
  function problem(el) {
    var type = (el.type || '').toLowerCase();
    var name = labelOf(el);
    var value = type === 'file' || type === 'checkbox' || type === 'radio' ? '' : String(el.value || '');
    var trimmed = value.trim();

    if (type === 'checkbox') {
      return el.required && !el.checked ? 'Tick this box to continue.' : '';
    }
    if (type === 'file') {
      return el.required && !(el.files && el.files.length) ? 'Choose a photo to upload.' : '';
    }
    if (el.required && !trimmed) {
      return el.tagName === 'SELECT' ? 'Choose ' + (/^(a|an|the)\s/i.test(name) ? lower(name) : 'a ' + lower(name)) + '.' : name + ' is required.';
    }
    if (!trimmed) return '';
    if (type === 'email' && !EMAIL.test(trimmed)) return 'Enter a valid email address, like name@example.com.';
    if (type === 'url') {
      try { var u = new URL(trimmed); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw 0; }
      catch (e) { return 'Enter a full web address starting with https://'; }
    }
    if (el.minLength > 0 && value.length < el.minLength) {
      return name + ' must be at least ' + el.minLength + ' characters (you have ' + value.length + ').';
    }
    if (el.maxLength > 0 && value.length > el.maxLength) {
      return name + ' must be ' + el.maxLength + ' characters or fewer.';
    }
    if (type === 'number') {
      var n = Number(value);
      if (isNaN(n)) return 'Enter a number.';
      if (el.min !== '' && n < Number(el.min)) return name + ' must be ' + el.min + ' or more.';
      if (el.max !== '' && n > Number(el.max)) return name + ' must be ' + el.max + ' or less.';
    }
    if (el.pattern) {
      var ok = true;
      try { ok = new RegExp('^(?:' + el.pattern + ')$').test(value); } catch (e) { ok = true; }
      if (!ok) return el.title || 'Check the format of ' + lower(name) + '.';
    }
    return '';
  }

  function holderOf(el) {
    // Put the message after the whole control, e.g. after the password box with its eye button.
    var wrap = el.closest('.password-field, .phone-field, .phone-row');
    return wrap || el;
  }

  function errorNode(el) {
    var id = (el.id || el.name || 'field') + '-error';
    var node = document.getElementById(id);
    if (!node) {
      node = document.createElement('span');
      node.id = id;
      node.className = 'field-error';
      node.setAttribute('role', 'alert');
      holderOf(el).insertAdjacentElement('afterend', node);
    }
    return node;
  }

  function setError(target, message) {
    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    var node = errorNode(el);
    node.textContent = message;
    node.hidden = false;
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', node.id);
    el.classList.add('is-invalid');
    var label = el.labels && el.labels[0];
    if (label) label.classList.add('has-error');
    if (!el.__fvLive) {
      el.__fvLive = true;
      var recheck = function () {
        if (el.getAttribute('aria-invalid') !== 'true') return;
        var again = problem(el);
        if (again) setError(el, again); else clearError(el);
      };
      el.addEventListener('input', recheck);
      el.addEventListener('change', recheck);
    }
  }

  function clearError(el) {
    var node = document.getElementById((el.id || el.name || 'field') + '-error');
    if (node) { node.textContent = ''; node.hidden = true; }
    el.removeAttribute('aria-invalid');
    el.removeAttribute('aria-describedby');
    el.classList.remove('is-invalid');
    var label = el.labels && el.labels[0];
    if (label) label.classList.remove('has-error');
  }

  function clearErrors(form) { fields(form).forEach(clearError); }

  function check(form) {
    var first = null;
    var count = 0;
    fields(form).forEach(function (el) {
      var message = problem(el);
      if (message) { setError(el, message); count++; if (!first) first = el; }
      else clearError(el);
    });
    return { count: count, first: first };
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM' || form.hasAttribute('data-no-validate')) return;
    form.noValidate = true; // we show our own messages instead of the browser's pop-ups
    var result = check(form);
    if (!result.count) {
      var ok = form.querySelector('.form-summary-error');
      if (ok) ok.classList.remove('form-summary-error');
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    // Replace any old page-level status (like "Signing in...") with a summary.
    var status = form.querySelector('#message, #status');
    if (status) {
      status.textContent = result.count === 1 ? 'Please fix the highlighted field.' : 'Please fix the ' + result.count + ' highlighted fields.';
      status.classList.add('form-summary-error');
    }
    result.first.focus();
    if (result.first.scrollIntoView) result.first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, true);

  // The page-level summary is cleared again once the page writes its own message.
  document.addEventListener('input', function (event) {
    var form = event.target && event.target.form;
    var status = form && form.querySelector('.form-summary-error');
    if (status && !form.querySelector('[aria-invalid="true"]')) { status.textContent = ''; status.classList.remove('form-summary-error'); }
  });

  // The browser's own pop-up checks would stop the submit before ours can run, so turn them off
  // for every form on the page (ours are stricter and explain each field).
  function takeOver() {
    Array.prototype.forEach.call(document.forms, function (form) {
      if (!form.hasAttribute('data-no-validate')) form.noValidate = true;
    });
  }
  takeOver();
  document.addEventListener('DOMContentLoaded', takeOver);

  window.VHMARTForm = { setError: setError, clearError: clearError, clearErrors: clearErrors, check: check };
})();
