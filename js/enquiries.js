import { database } from './firebase.js';
import { get, ref, query, orderByChild, equalTo } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js';

// Loads every enquiry a customer sent to this vendor.
//
// An enquiry is stored in `enquiries` and copied to the vendor's own
// `vendor_enquiries/{uid}` list. Reading only one of the two hides enquiries whenever
// the other is missing (the copy is best-effort), so both are read and merged by id.
// `enquiries` wins on conflict because it is the record the customer's write
// is validated against.
export async function loadVendorEnquiries(uid) {
  const [mirror, main] = await Promise.allSettled([
    get(ref(database, `vendor_enquiries/${uid}`)),
    get(query(ref(database, 'enquiries'), orderByChild('vendorId'), equalTo(uid)))
  ]);
  if (mirror.status === 'rejected' && main.status === 'rejected') throw main.reason;

  const merged = new Map();
  for (const result of [mirror, main]) {
    if (result.status === 'rejected') { console.warn('One enquiry source could not be read:', result.reason); continue; }
    if (!result.value.exists()) continue;
    for (const [id, item] of Object.entries(result.value.val())) merged.set(id, { ...(merged.get(id) || {}), ...item, id });
  }
  return [...merged.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function formatEnquiryDate(value) {
  const stamp = Number(value);
  if (!stamp) return '';
  return new Date(stamp).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}
