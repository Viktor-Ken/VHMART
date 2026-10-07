// Show/hide control for password fields.
//
// The eye control was missing from the sign-in page. It is a classic script
// rather than a module so it can be dropped into any page with a password
// field, including the pages whose scripts are otherwise fully minified.
//
// Markup contract: put the input and the button inside a wrapper and point the
// button at the input id.
//
//   <span class="password-field">
//     <input id="password" type="password" required>
//     <button type="button" class="password-toggle" data-password-toggle="password" aria-label="Show password" aria-pressed="false"></button>
//   </span>
(function () {
  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 12S5.6 5.2 12 5.2 22.2 12 22.2 12 18.4 18.8 12 18.8 1.8 12 1.8 12Z"/><circle cx="12" cy="12" r="3.1"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 5.4A9.9 9.9 0 0 1 12 5.2c6.4 0 10.2 6.8 10.2 6.8a18 18 0 0 1-2.7 3.6M6.3 7.6A17.7 17.7 0 0 0 1.8 12S5.6 18.8 12 18.8a9.7 9.7 0 0 0 3.8-.8"/><path d="M10.1 10.2a2.6 2.6 0 0 0 3.6 3.7"/><path d="M3.5 3.5l17 17"/></svg>';

  function enhance(input, button) {
    if (input.dataset.passwordToggleReady === 'true') return;
    input.dataset.passwordToggleReady = 'true';

    var label = button.getAttribute('aria-label') || 'Show password';
    var hiddenLabel = button.getAttribute('data-password-label-hidden') || 'Hide password';

    button.innerHTML = EYE;
    button.type = 'button';
    button.classList.add('password-toggle');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', input.id);

    // Keep tab order sane: the toggle sits after the input, so Tab already
    // reaches it. Space/Enter both activate a <button> natively.
    button.addEventListener('click', function (event) {
      // The button sits inside a <label for="...">, and a label forwards clicks
      // to its control. Cancelling the default action keeps the toggle from
      // being activated twice.
      if (event) event.preventDefault();
      var revealed = input.type === 'text';
      input.type = revealed ? 'password' : 'text';
      button.setAttribute('aria-pressed', revealed ? 'false' : 'true');
      button.setAttribute('aria-label', revealed ? label : hiddenLabel);
      button.title = revealed ? label : hiddenLabel;
      button.innerHTML = revealed ? EYE : EYE_OFF;
      // Return focus to the field so typing can continue straight away.
      input.focus();
    });

    // If anything resets the field (a failed sign-in clearing the form), the
    // control must fall back to the masked state rather than lying about it.
    var observer = new MutationObserver(function () {
      if (input.type !== 'password') return;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = EYE;
    });
    observer.observe(input, { attributes: true, attributeFilter: ['type'] });
  }

  function init() {
    var buttons = document.querySelectorAll('[data-password-toggle]');
    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      var input = document.getElementById(button.getAttribute('data-password-toggle'));
      if (input) enhance(input, button);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
