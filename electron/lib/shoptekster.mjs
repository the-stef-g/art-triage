// Shoppens faste tekster: handelsbetingelserne, privatlivspolitikken, teksten
// i kassen og teksten i ordremailen. Appen sender dem til WooCommerce med
// knappen Update shop texts, saa de kun staar ét sted. Beslutningerne bag
// (14 dages fortrydelsesret, beloebet reserveres og traekkes ved afsendelse)
// staar i sitets repo, docs/fortrydelsesret-og-betaling.md. Fortrydelses-
// teksten og formularen foelger EU's standardformuleringer (direktiv
// 2011/83/EU, bilag I).
//
// Aendres en tekst, saettes TEKST_DATO til dagen; den staar under
// privatlivspolitikken som Last updated.

export const TEKST_DATO = '30 October 2026';

export const SAELGER = {
  navn: "Stef's",
  adresse: ['Grønnegade 28b, st.', '6760 Ribe', 'Denmark'],
  cvr: 'DK21935891',
  mail: 'stef@stefg.art',
};

const adresseLinje = `${SAELGER.navn}, ${SAELGER.adresse.join(', ')}`;
const mailLink = `<a href="mailto:${SAELGER.mail}">${SAELGER.mail}</a>`;
const saelgerBlok = `<p>${SAELGER.navn}<br>${SAELGER.adresse.join('<br>')}<br>VAT/CVR: ${SAELGER.cvr}<br>Email: ${mailLink}</p>`;

// Landene de store canvas saelges til (prislisten, europe_only).
const EUROPA = 'the EU, Norway, Iceland, Liechtenstein, Switzerland, the United Kingdom, Andorra, Monaco, San Marino and the Vatican City';

// Leveringstid med produktion, i hverdage, fra Prodigis katalog og
// prisark (Standard-fragt).
const LEVERING = [
  ['Denmark', '4–6', '5'],
  ['Germany', '3–5', '4–5'],
  ['Sweden', '5–8', '5–8'],
  ['Norway, Switzerland', '6–11', '6'],
  ['United Kingdom', '4–6', '4'],
  ['USA', '3–8', '4–8'],
  ['Canada', '3–7', '4–7'],
  ['Australia', '9–13', '10–13'],
  ['Japan', '5–8', '10–17'],
];

const FORMULAR = `<p>(Complete and return this form only if you wish to withdraw from the contract.)</p>
<p>To ${adresseLinje}, ${SAELGER.mail}:</p>
<ul>
<li>I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of sale of the following goods (*):</li>
<li>Ordered on (*) / received on (*):</li>
<li>Order number:</li>
<li>Name of consumer(s):</li>
<li>Address of consumer(s):</li>
<li>Signature of consumer(s) (only if this form is notified on paper):</li>
<li>Date:</li>
</ul>
<p>(*) Delete as appropriate.</p>`;

// Handelsbetingelserne. privatlivUrl er adressen paa privatlivspolitikken.
export function betingelser(privatlivUrl) {
  const tabel = LEVERING.map(([land, papir, canvas]) => `<tr><td>${land}</td><td>${papir}</td><td>${canvas}</td></tr>`).join('\n');
  return `<p>These terms apply to all purchases from shop.stefg.art.</p>

<h2>Seller</h2>
${saelgerBlok}

<h2>Original works and prints</h2>
<p>Original works (paintings and sculptures) are unique and sent from Ribe, Denmark.</p>
<p>Prints are made to order by our print partner, Prodigi, when you order. Production takes up to 3 working days, and the print is then shipped from the print lab. Delivery times including production, in working days:</p>
<table>
<thead><tr><th>Destination</th><th>Paper prints</th><th>Canvas</th></tr></thead>
<tbody>
${tabel}
</tbody>
</table>
<p>Other countries: write to us before you order. The times are estimates from our print partner and are not guaranteed.</p>

<h2>Prices</h2>
<p>All prices are in Danish kroner (DKK) and include VAT. Shipping is free and included in the price. Prints are made in the print lab nearest to you whenever possible. If an order has to cross a customs border, for instance into or out of the EU, import duties and taxes may be charged by the customs authorities in your country when the parcel arrives. These are paid by you.</p>

<h2>Payment</h2>
<p>We accept credit and debit cards, Apple Pay, Google Pay and MobilePay. Payments are handled by Stripe; we never see or store your card details.</p>
<p>The amount is reserved on your card when you order and is only charged when your order has been shipped. If the order is cancelled before it is shipped, the reservation is released and nothing is charged.</p>

<h2>The contract</h2>
<p>The contract is made when you receive our order confirmation by email. The contract is in English. We keep a copy of your order, and you can find it in the confirmation email.</p>

<h2>Right of withdrawal</h2>
<p>You have the right to withdraw from this contract within 14 days without giving any reason. This applies to prints as well as original works.</p>
<p>The withdrawal period will expire after 14 days from the day on which you, or a third party other than the carrier and indicated by you, acquire physical possession of the goods. If you order several goods that are delivered separately, the period runs from the day you receive the last of them.</p>
<p>To exercise the right of withdrawal, you must inform us (${adresseLinje}, ${mailLink}) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or an email). You may use the model withdrawal form below, but it is not obligatory.</p>
<p>To meet the withdrawal deadline, it is sufficient for you to send your communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.</p>
<p>You may also cancel your order before it has been shipped. Then the reservation on your card is released, and nothing is charged.</p>

<h2>Effects of withdrawal</h2>
<p>If you withdraw from this contract, we shall reimburse to you all payments received from you, including the costs of delivery, without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw from this contract. We will carry out such reimbursement using the same means of payment as you used for the initial transaction, unless you have expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement.</p>
<p>We may withhold reimbursement until we have received the goods back or you have supplied evidence of having sent back the goods, whichever is the earliest.</p>
<p>You shall send back the goods to ${adresseLinje}, without undue delay and in any event not later than 14 days from the day on which you communicate your withdrawal from this contract to us. The deadline is met if you send back the goods before the period of 14 days has expired.</p>
<p>You will have to bear the direct cost of returning the goods. Paper prints, canvases up to 75 × 75, 60 × 90 and 60 × 120 cm, and sculptures can be returned as an ordinary parcel. Canvases of 100 × 100, 120 × 120, 80 × 120 and 100 × 150 cm are too large for an ordinary parcel; they are only sold for delivery in ${EUROPA}, and returning one is estimated to cost at most approximately EUR 400.</p>
<p>You are only liable for any diminished value of the goods resulting from handling other than what is necessary to establish the nature, characteristics and functioning of the goods. Please pack the goods well, preferably in the original packaging.</p>

<h2>Model withdrawal form</h2>
${FORMULAR}

<h2>Damaged or faulty goods</h2>
<p>Please check your order when it arrives. If it is damaged in transport or faulty, write to ${mailLink} within a reasonable time, preferably with photos, and we will replace it or refund you. You have a right to complain about faults under Danish law for 2 years from delivery.</p>

<h2>Complaints</h2>
<p>If you are not satisfied, please write to ${mailLink} first, and we will try to find a solution. If we cannot agree, you can complain to the Danish Complaints Board for Consumers, Nævnenes Hus, Toldboden 2, 8800 Viborg, Denmark, <a href="https://www.naevneneshus.dk">www.naevneneshus.dk</a>.</p>

<h2>Personal data</h2>
<p>How we handle your personal data is described in our <a href="${privatlivUrl}">privacy policy</a>.</p>`;
}

export function privatlivspolitik() {
  return `<p>This policy explains how ${SAELGER.navn} handles your personal data when you visit stefg.art and shop.stefg.art or buy from us.</p>

<h2>Who is responsible</h2>
${saelgerBlok}
<p>Write to us if you have questions about your data or want to use your rights.</p>

<h2>What we collect and why</h2>
<ul>
<li><strong>When you buy:</strong> your name, delivery and billing address, email address and phone number, what you ordered, and the payment status (never your card details). We use it to make, ship and deliver your order, to send you emails about it, and to handle withdrawals, returns and complaints. The legal basis is the contract with you (GDPR article 6(1)(b)).</li>
<li><strong>Bookkeeping:</strong> orders and invoices are kept as required by the Danish Bookkeeping Act. The legal basis is our legal obligation (article 6(1)(c)).</li>
<li><strong>When you write to us:</strong> your email address and what you write, so we can answer. The legal basis is our legitimate interest in answering you (article 6(1)(f)).</li>
<li><strong>When you visit the shop:</strong> the shop only uses cookies that are needed for the basket, the checkout and the payment to work. We do not use cookies for statistics or advertising, and they do not track you across other websites.</li>
<li><strong>Newsletter:</strong> if you sign up for our newsletter, we use your email address to send it to you. The legal basis is your consent (article 6(1)(a)). Every newsletter has a link to unsubscribe, and you can withdraw your consent at any time.</li>
</ul>
<p>We do not sell your data, and we do not use it for marketing unless you have signed up for it. You can buy as a guest; you do not need to create an account.</p>

<h2>Who we share it with</h2>
<p>We only share what each of them needs to do their part:</p>
<ul>
<li><strong>Prodigi</strong> (Prodigi Group Ltd, United Kingdom) makes and ships prints. They receive your name, delivery address, email or phone number for the carrier, and what you ordered. The UK has an adequacy decision from the EU, so your data has the same protection there.</li>
<li><strong>The carrier</strong> that delivers your parcel receives your name and delivery address, and your email or phone number for tracking.</li>
<li><strong>Stripe</strong> handles payments, including cards, Apple Pay, Google Pay and MobilePay. Stripe processes your payment details under its own privacy policy. Stripe may transfer data to the United States under the EU–US Data Privacy Framework and standard contractual clauses.</li>
<li><strong>Our web host,</strong> 20i (United Kingdom), stores the shop and its database.</li>
<li><strong>Public authorities</strong> when the law requires it, for instance the Danish tax authorities.</li>
</ul>

<h2>How long we keep it</h2>
<ul>
<li>Orders, invoices and other bookkeeping records: 5 years from the end of the financial year they belong to, as the Danish Bookkeeping Act requires.</li>
<li>Newsletter: until you unsubscribe.</li>
<li>Emails with us: as long as needed to answer you and handle any complaint, at most 3 years.</li>
</ul>

<h2>Your rights</h2>
<p>You have the right to see the data we hold about you, to have it corrected or deleted, to restrict its use, to object to it, and to receive it in a common format (data portability). Some data we must keep, for instance for bookkeeping. To use your rights, write to ${mailLink}.</p>

<h2>Complaints</h2>
<p>You can complain to the Danish Data Protection Agency (Datatilsynet), Carl Jacobsens Vej 35, 2500 Valby, Denmark, <a href="https://www.datatilsynet.dk">www.datatilsynet.dk</a>.</p>

<h2>Changes</h2>
<p>We update this policy when the way we handle data changes. Last updated: ${TEKST_DATO}.</p>`;
}

// Teksten over koebsknappen i kassen. [privacy_policy] og [terms] erstatter
// WooCommerce selv med links.
export const KASSE_TEKST = 'Prints are made to order and shipped from the print lab within 3 working days. '
  + 'Delivery usually takes 3 to 8 working days in Europe and North America, and up to 3 weeks to Australia and Japan. '
  + 'Prices include VAT and free shipping. '
  + 'The amount is reserved on your card when you order and is only charged when your order has been shipped. '
  + 'You have 14 days to change your mind after you receive your order; see our [terms]. '
  + 'Your personal data is handled as described in our [privacy_policy].';

// Ordremailen: fortrydelsesretten og formularen skal med i mailen, for en
// hjemmeside er ikke et varigt medium. Almindelig tekst, som WooCommerce
// selv saetter linjeskift i.
export const MAIL_TEKST = `Thank you for your order. Prints are made to order and shipped from the print lab within 3 working days. The amount is reserved on your card now and charged when your order is shipped. You will receive an email when it is on its way.

Your right of withdrawal
You have the right to withdraw from this contract within 14 days without giving any reason, counted from the day you receive the goods. To withdraw, send us a clear statement, for instance by email to ${SAELGER.mail}. You can use the form below, but you do not have to. If you cancel before your order is shipped, the reservation is released and nothing is charged.

If you withdraw, we refund all payments, including delivery, within 14 days of hearing from you. We may wait until we have received the goods back, or you have shown that you have sent them. Send the goods to ${adresseLinje}, within 14 days after telling us. You pay the cost of returning the goods.

Model withdrawal form
To ${adresseLinje}, ${SAELGER.mail}:
I/We hereby give notice that I/We withdraw from my/our contract of sale of the following goods: …
Ordered on / received on: …
Order number: …
Name: …
Address: …
Signature (only on paper): …
Date: …

${SAELGER.navn} · ${SAELGER.adresse.join(' · ')} · CVR ${SAELGER.cvr}`;
