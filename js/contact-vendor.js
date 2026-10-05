import { auth, database } from './firebase.js';
import { get, ref, push, set, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';
import { contactChannels, withPrefilledMessage } from './contact-links.js';

// Customer-facing "contact vendor" panel.
//
// The customer picks one of the channels the vendor published, accepts the
// terms and conditions, and only then is the enquiry recorded and the link
// opened. Both gates are enforced here rather than in markup, so they hold
// however the panel is rendered.
//
// Link safety lives in contact-links.js, which is unit tested on its own: the
// vendor's details are untrusted input used as a link target.

const DEFAULT_TERMS_URL = '/terms-and-conditions.html';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function renderContactPanel(mount, context) {
  const { vendorId, productId, productName, vendorName, termsUrl } = context;

  const panel = el('section', 'contact-panel');
  panel.append(el('h2', null, 'Contact vendor'));
  panel.append(el('p', null, vendorName
    ? `Choose how to reach ${vendorName} about this product.`
    : 'Choose how to reach the vendor about this product.'));

  const status = el('p', 'empty');
  status.hidden = true;
  panel.append(status);

  const form = document.createElement('form');
  form.noValidate = true;

  const fieldset = el('fieldset', 'contact-panel__channels');
  const legend = el('legend', null, 'Contact method');
  fieldset.append(legend);

  const rows = [];
  const continueButton = el('button', 'button button--primary', 'Continue');
  continueButton.type = 'button';
  continueButton.disabled = true;

  const terms = el('label', 'contact-panel__terms');
  const termsBox = document.createElement('input');
  termsBox.type = 'checkbox';
  const termsText = document.createElement('span');
  const termsLink = document.createElement('a');
  termsLink.href = termsUrl || DEFAULT_TERMS_URL;
  termsLink.target = '_blank';
  termsLink.rel = 'noopener noreferrer';
  termsLink.textContent = 'terms and conditions';
  termsText.append('I have read and accept the ', termsLink, '.');
  terms.append(termsBox, termsText);

  const termsError = el('p', 'error', 'Accept the terms and conditions before continuing.');
  termsError.hidden = true;

  form.append(fieldset, terms, termsError, continueButton);
  panel.append(form);
  mount.append(panel);

  // Both a channel and the terms are required. Neither gate alone is enough.
  function sync() {
    const picked = rows.find((row) => row.input.checked);
    continueButton.disabled = !(picked && termsBox.checked);
    if (termsBox.checked) termsError.hidden = true;
  }

  termsBox.addEventListener('change', sync);

  continueButton.addEventListener('click', async () => {
    const picked = rows.find((row) => row.input.checked);
    if (!picked || !termsBox.checked) {
      if (!termsBox.checked) termsError.hidden = false;
      return;
    }

    // An enquiry must be attributable, and the rules require customerUid, so an
    // anonymous visitor is sent to sign in before anything is recorded.
    if (!auth.currentUser) {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }

    continueButton.disabled = true;
    status.hidden = false;
    status.textContent = 'Sending your enquiry...';
    try {
      await recordEnquiry({
        vendorId,
        productId,
        productName,
        vendorName,
        channel: picked.channel.key
      });
      // Opened only after the terms were accepted and the enquiry stored, so the
      // vendor has a record before the customer leaves the site.
      //
      // The body is prefilled where the channel supports one, so a WhatsApp or
      // email handoff arrives with context instead of a blank compose box. The
      // enquiry record in the vendor dashboard remains the durable copy.
      const outgoing = withPrefilledMessage(
        picked.channel.url,
        `Hi${vendorName ? `, this is a customer via VHMART` : ''}. I would like to ask about "${String(productName || 'your listing').slice(0, 120)}" on VHMART.`
      );
      window.open(outgoing, '_blank', 'noopener,noreferrer');
      status.textContent = 'Enquiry sent. Your contact method opened in a new tab.';
    } catch (error) {
      console.error(error);
      status.textContent = 'We could not send your enquiry. Please try again.';
      continueButton.disabled = false;
    }
  });

  // Populate once the vendor record arrives. Public contact details are readable
  // only while the vendor is active, which the rules already enforce.
  (async () => {
    let vendor = null;
    try {
      const snapshot = await get(ref(database, `vendors/${vendorId}`));
      vendor = snapshot.val();
    } catch (error) {
      console.error(error);
    }

    const channels = contactChannels(vendor);
    if (!channels.length) {
      form.remove();
      panel.append(el('p', 'empty', 'This vendor has not published a contact method yet.'));
      return;
    }

    for (const channel of channels) {
      const row = el('label', 'contact-panel__channel');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'contact-channel';
      input.value = channel.key;
      const text = el('span', null, `${channel.label}: ${channel.raw}`);
      row.append(input, text);
      input.addEventListener('change', sync);
      fieldset.append(row);
      rows.push({ input, channel });
    }
    sync();
  })();
}

async function recordEnquiry({ vendorId, productId, productName, vendorName, channel }) {
  const user = auth.currentUser;
  const enquiryRef = push(ref(database, 'enquiries'));
  await set(enquiryRef, {
    productId,
    vendorId,
    customerUid: user.uid,
    customerEmail: (user.email || '').slice(0, 200),
    // Fixed text: the customer is being handed off to a vendor channel, not
    // composing a message. Keeping it deterministic also avoids free text
    // landing in the vendor inbox unfiltered.
    message: `Contact request for "${String(productName || 'this product').slice(0, 160)}" via ${channel}.`,
    channel,
    termsAcceptedAt: serverTimestamp(),
    status: 'NEW',
    createdAt: serverTimestamp()
  });
}