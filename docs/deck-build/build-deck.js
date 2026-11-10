#!/usr/bin/env node
/**
 * Builds "Service Mesh for Developers" as a .pptx.
 *
 * Source of truth for content is ../slides-outline-developer-intro.md.
 * Edit that first, then mirror the change here.
 *
 * Import path into Google Slides:
 *   open the Red Hat-templated deck -> File -> Import slides -> pick this .pptx
 *   -> UNCHECK "Keep original theme" so the slides adopt the Red Hat master.
 *
 * Styling here is deliberately plain: it is discarded on import. What matters
 * is that each slide uses title/body placeholders so it maps onto a layout.
 */

const PptxGenJS = require('pptxgenjs');

const INK = '151515';
const MUTED = '6A6E73';
const RED = 'EE0000';

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9'; // 13.333 x 7.5 in
pptx.author = 'Jeff Franklin';
pptx.company = 'Red Hat';
pptx.title = 'Service Mesh for Developers';

/* ---------- masters: placeholders are what let Google map these onto your layouts ---------- */

pptx.defineSlideMaster({
  title: 'TITLE_SLIDE',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.9, y: 2.3, w: 11.5, h: 1.5, fontSize: 44, bold: true, color: INK }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.9, y: 3.9, w: 11.5, h: 2.2, fontSize: 20, color: MUTED }, text: '' } },
  ],
});

pptx.defineSlideMaster({
  title: 'SECTION',
  background: { color: '151515' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.9, y: 3.0, w: 11.5, h: 1.5, fontSize: 40, bold: true, color: 'FFFFFF' }, text: '' } },
  ],
});

pptx.defineSlideMaster({
  title: 'CONTENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 32, bold: true, color: INK }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 1.7, w: 11.9, h: 5.1, fontSize: 18, color: INK }, text: '' } },
  ],
});

pptx.defineSlideMaster({
  title: 'TWO_CONTENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 32, bold: true, color: INK }, text: '' } },
    { placeholder: { options: { name: 'left', type: 'body', x: 0.7, y: 1.7, w: 5.7, h: 5.1, fontSize: 17, color: INK }, text: '' } },
    { placeholder: { options: { name: 'right', type: 'body', x: 6.9, y: 1.7, w: 5.7, h: 5.1, fontSize: 17, color: INK }, text: '' } },
  ],
});

pptx.defineSlideMaster({
  title: 'STATEMENT',
  background: { color: 'FFFFFF' },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 32, bold: true, color: INK }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 2.4, w: 11.9, h: 3.0, fontSize: 60, bold: true, color: RED }, text: '' } },
  ],
});

/* ---------- helpers ---------- */

// "Today: / Instead:" pairs, stacked rather than columned — stacked imports far more cleanly.
const beforeAfter = (today, instead, extra = []) => [
  { text: 'Today', options: { bold: true, color: MUTED, fontSize: 15, breakLine: true } },
  { text: today, options: { fontSize: 19, breakLine: true, paraSpaceAfter: 18 } },
  { text: 'Instead', options: { bold: true, color: RED, fontSize: 15, breakLine: true } },
  { text: instead, options: { fontSize: 19, breakLine: true, paraSpaceAfter: 12 } },
  ...extra.map((t) => ({ text: t, options: { fontSize: 15, color: MUTED, breakLine: true } })),
];

const bullets = (items) =>
  items.map((t) => ({ text: t, options: { bullet: true, fontSize: 19, paraSpaceAfter: 10 } }));

// Visible, sized box marking where a screenshot goes. Delete after pasting the real image.
function imagePlaceholder(slide, label, { x = 0.7, y = 1.7, w = 11.9, h = 4.9 } = {}) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: 'F5F5F5' },
    line: { color: 'B0B0B0', width: 1, dashType: 'dash' },
  });
  slide.addText(label, {
    x, y, w, h,
    align: 'center', valign: 'middle',
    fontSize: 16, color: MUTED, italic: true,
  });
}

function contentSlide({ title, body, notes }) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText(title, { placeholder: 'title' });
  s.addText(body, { placeholder: 'body' });
  if (notes) s.addNotes(notes);
  return s;
}

function imageSlide({ title, label, caption, notes }) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText(title, { placeholder: 'title' });
  const h = caption ? 4.3 : 4.9;
  imagePlaceholder(s, label, { h });
  if (caption) {
    s.addText(caption, { x: 0.7, y: 6.15, w: 11.9, h: 0.5, fontSize: 16, color: MUTED });
  }
  if (notes) s.addNotes(notes);
  return s;
}

function sectionSlide(title) {
  const s = pptx.addSlide({ masterName: 'SECTION' });
  s.addText(title, { placeholder: 'title' });
  return s;
}

function statementSlide({ title, word, sub, notes }) {
  const s = pptx.addSlide({ masterName: 'STATEMENT' });
  s.addText(title, { placeholder: 'title' });
  s.addText(word, { placeholder: 'body' });
  if (sub) s.addText(sub, { x: 0.7, y: 5.3, w: 11.9, h: 1.2, fontSize: 19, color: INK });
  if (notes) s.addNotes(notes);
  return s;
}

/* =====================  ACT 1  ===================== */

{
  const s = pptx.addSlide({ masterName: 'TITLE_SLIDE' });
  s.addText('Service Mesh for Developers', { placeholder: 'title' });
  s.addText(
    [
      { text: "What it is, and why you'd want one", options: { fontSize: 22, color: INK, breakLine: true, paraSpaceAfter: 20 } },
      { text: 'Jeff Franklin', options: { fontSize: 17, bold: true, color: INK, breakLine: true } },
      { text: 'Senior Specialist Solution Architect  ·  jefr@redhat.com', options: { fontSize: 16, color: MUTED } },
    ],
    { placeholder: 'body' },
  );
}

contentSlide({
  title: 'Three Days to Find One Bad Hop',
  body: [
    { text: 'A checkout request fails. Intermittently. About 2% of the time.', options: { fontSize: 24, breakLine: true, paraSpaceAfter: 24 } },
    { text: 'Five services are involved.', options: { fontSize: 24, breakLine: true } },
    { text: 'You have logs from all five.', options: { fontSize: 24, breakLine: true } },
    { text: 'Every one of them reports that it did its job.', options: { fontSize: 24, bold: true, breakLine: true } },
  ],
  notes:
    "Open here, not on a definition. Tell it as something that happened, present tense. Ask for a show of hands: who has spent more than a day finding out which service in a chain was the broken one? Most of the room will raise a hand. That raised hand is the entire premise of the talk — don't rush past it.",
});

contentSlide({
  title: 'Look in Your Own Repo',
  body: [
    { text: 'Code that ships in your service and has nothing to do with your product:', options: { fontSize: 19, color: MUTED, breakLine: true, paraSpaceAfter: 16 } },
    ...bullets([
      "Retry logic, with somebody's guess at a backoff curve",
      'Timeout constants',
      'TLS setup between services',
      'Trace header propagation (and the one place it gets dropped)',
      "A circuit breaker, configured differently than the team next door's",
    ]),
    { text: 'Every team writes this. Every team writes it slightly differently.', options: { fontSize: 19, bold: true, paraSpaceBefore: 16 } },
  ],
  notes:
    "This is the slide where they recognize themselves. Pause on it. The point isn't that the code is bad — it's that five teams wrote five versions of the same thing, and none of them are the product.",
});

imageSlide({
  title: 'Is This a *Micro* Service?',
  label: 'PASTE: "Is this a micro service?" diagram — p.5 of the existing OSSM3 introduction deck',
  notes:
    'The one slide in the old deck already pitched at exactly this altitude. It lands without explanation — let the picture do the work and move on.',
});

contentSlide({
  title: "Three Questions You Can't Answer",
  body: [
    { text: 'About an application your team owns, right now:', options: { fontSize: 19, color: MUTED, breakLine: true, paraSpaceAfter: 20 } },
    ...bullets([
      'Who called this service in the last hour?',
      'Was that call encrypted?',
      'Which hop made the request slow?',
    ]).map((b) => ({ ...b, options: { ...b.options, fontSize: 24, paraSpaceAfter: 16 } })),
  ],
  notes:
    'Ask the room to answer for their own service. The honest answer to all three is usually "I\'d have to go find out," and finding out means reading five repos. That gap is not a tooling failure — it\'s structural, which is the next slide.',
});

contentSlide({
  title: 'The Space Between Your Services',
  body: [
    { text: 'All three answers live in the same place: the network between services.', options: { fontSize: 24, breakLine: true, paraSpaceAfter: 20 } },
    { text: "That's the one layer your code doesn't own and can't see.", options: { fontSize: 24, breakLine: true, paraSpaceAfter: 20 } },
    { text: 'A service mesh manages that layer, and hands the answers back to you.', options: { fontSize: 24, bold: true, breakLine: true, paraSpaceAfter: 20 } },
    { text: 'The one underneath OpenShift Service Mesh is the open source Istio project.', options: { fontSize: 17, color: MUTED } },
  ],
  notes:
    'This is the hinge of the talk. Say "Istio" once, here, so the room knows this is not a proprietary thing, then drop the word for the rest of the deck. Everything after this is "what the mesh gives you" and "what it costs you."',
});

/* =====================  ACT 2  ===================== */

sectionSlide("What You'd Get");

imageSlide({
  title: "A Map You Didn't Draw",
  label: 'PASTE: Kiali topology graph — full bleed. Capture from the demo cluster with traffic flowing.',
  caption: 'Today: an architecture diagram in Confluence, accurate as of eight months ago.',
  notes:
    'The first time a team sees this, somebody says "wait, why does THAT call THAT?" That reaction is the sales pitch — mention that it happens, and that it is usually a surprise about their own app.\n\nOPTIONAL DEMO PIVOT: live Kiali against the bookinfo namespace. The slide works alone if you skip it.',
});

contentSlide({
  title: 'Golden Signals, Per Service',
  body: beforeAfter(
    'Add a metrics library to each service, expose an endpoint, and hope every team picked the same histogram buckets.',
    'Request rate, error rate, and latency percentiles for every enrolled service, in the same shape, whether or not anyone instrumented it.',
  ),
  notes: 'Emphasize SAME SHAPE. Comparable metrics across teams is the part that is hard to get any other way.',
});

imageSlide({
  title: 'Traces Without Instrumenting',
  label: 'PASTE: trace waterfall showing a span per hop — Tempo / Jaeger view',
  caption: 'Today: a tracing SDK in every service, context propagated by hand.',
  notes:
    'Be honest here or you will lose the skeptics — you still instrument inside your own code for business-level spans. What you get for free is every hop between services, which is exactly the part that was missing in the slide 2 story. Call that back explicitly.',
});

contentSlide({
  title: 'Every Call Encrypted',
  body: beforeAfter(
    'TLS between internal services is a project nobody schedules. Certificates, rotation, a trust store per service.',
    'Mutual TLS on every call between enrolled services, with certificates issued and rotated for you.',
  ),
  notes:
    'For the compliance-minded in the room: this is encryption in transit inside the cluster, which is usually an audit finding somebody is carrying. Worth saying once, plainly.',
});

contentSlide({
  title: 'Identity Instead of IP Addresses',
  body: beforeAfter(
    '"Allow 10.128.0.0/16 to reach port 8080" — which is to say, allow everything.',
    '"The checkout service may call the payment service" — by name, proven with a certificate, regardless of which node the pod landed on.',
  ),
  notes:
    'This is the conceptual leap of the whole talk, and it is worth its own slide. Identity stops being a location. Resist the urge to name the standard behind it.',
});

contentSlide({
  title: 'Who Can Call What',
  body: beforeAfter(
    'A firewall ticket, a two-week wait, and a rule written in addresses nobody can read six months later.',
    'Start from "nothing may call this," then allow the specific services that should — expressed in the names your team already uses.',
  ),
  notes:
    'Developers rarely ask for this, but they recognize the ticket. Platform engineers in the room will perk up here — this is the slide that makes the mesh their win too.',
});

contentSlide({
  title: 'Ten Percent to the New Version',
  body: beforeAfter(
    'A feature flag in the code, or a second deployment and a pipeline stage to manage it.',
    'Send 10% of real traffic to v2 and the rest to v1. Watch the error rate. Move the number.',
  ),
  notes:
    'No new build, and no code path that has to be cleaned up afterwards. For teams doing trunk-based development this is often the single most wanted item in the deck.\n\nOPTIONAL DEMO PIVOT: the canary rollout against the REST API demo.',
});

contentSlide({
  title: "Failures You Didn't Handle",
  body: beforeAfter(
    'A resilience library per language, configured to a different standard on each team.',
    'Retries, timeouts, and pulling a failing instance out of rotation, applied uniformly at the network layer.',
    ['This covers transport-level failure, not a bug in your business logic.'],
  ),
  notes:
    'Say the honest caveat out loud: this covers transport-level failure, not a bug in your business logic, and it does not excuse you from thinking about idempotency. Saying so costs nothing and buys credibility for Act 3.',
});

/* =====================  ACT 3  ===================== */

sectionSlide('What It Costs You');

statementSlide({
  title: 'What Changes in Your Code',
  word: 'Nothing.',
  notes:
    'One word on the slide. Let it sit for a beat before explaining — the silence does more than a bullet list would. Then one sentence: there is no library to add, in any language.',
});

statementSlide({
  title: 'What Changes in Your Deployment',
  word: 'Nothing.',
  sub: 'Your Deployment, your Service, your container image — unchanged. Nothing is injected into your pod.',
  notes:
    'The second "nothing" is the one that surprises people who looked at service mesh a few years ago and remember it rewriting their pod spec. If anyone in the room has that memory, this is the slide that updates it. You do not need to explain what changed, only that it did.',
});

{
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText('How Your App Joins', { placeholder: 'title' });
  s.addText('The only configuration in this deck:', { x: 0.7, y: 1.7, w: 11.9, h: 0.5, fontSize: 19, color: MUTED });
  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 2.5, w: 11.9, h: 1.3, fill: { color: '151515' } });
  s.addText('oc label namespace my-app istio.io/dataplane-mode=ambient', {
    x: 0.9, y: 2.5, w: 11.5, h: 1.3,
    fontFace: 'Courier New', fontSize: 19, color: 'FFFFFF', valign: 'middle',
  });
  s.addText(
    [
      { text: 'Somebody with namespace permissions applies that.', options: { fontSize: 22, breakLine: true } },
      { text: 'Your running pods join the mesh.', options: { fontSize: 22, bold: true } },
    ],
    { x: 0.7, y: 4.4, w: 11.9, h: 1.5 },
  );
  s.addNotes(
    'The rhetorical point is length — it is one line, and it is the last line of YAML in the talk.\n\n' +
      'ON THE WORD "ambient": it is unavoidable here, it is the literal label value. Do not draw attention to it. If someone asks, one sentence: "that is the name of the data plane mode — it is how the mesh runs now." Then move on; the comparison to the older model is not a conversation worth having in this room.\n\n' +
      'OPTIONAL DEMO PIVOT: enroll a namespace live and show the pods staying 1/1 through it.',
  );
}

contentSlide({
  title: 'What You Do Need to Do',
  body: [
    { text: 'Three things that actually bite:', options: { fontSize: 19, color: MUTED, breakLine: true, paraSpaceAfter: 18 } },
    { text: 'Name your ports. ', options: { bold: true, fontSize: 20, bullet: true } },
    { text: 'A Service port called http or grpc gets L7 features. An unnamed one is treated as opaque TCP.', options: { fontSize: 20, breakLine: true, paraSpaceAfter: 14 } },
    { text: 'Talk to Services, not pod IPs. ', options: { bold: true, fontSize: 20, bullet: true } },
    { text: 'Anything hard-coded to an address bypasses the mesh.', options: { fontSize: 20, breakLine: true, paraSpaceAfter: 14 } },
    { text: 'Keep readiness probes honest. ', options: { bold: true, fontSize: 20, bullet: true } },
    { text: 'The mesh routes on them.', options: { fontSize: 20 } },
  ],
  notes:
    'This is the real homework, and it is short. Naming ports is the one that catches teams most often. Being specific here is what makes the earlier "nothing changes" claims believable rather than glib.',
});

contentSlide({
  title: 'What It Costs the Cluster',
  body: [
    { text: 'Measured on our demo cluster — 3 nodes, 17 application pods, averaged over a week:', options: { fontSize: 17, color: MUTED, breakLine: true, paraSpaceAfter: 16 } },
    { text: 'On every node: ', options: { bold: true, fontSize: 21, bullet: true } },
    { text: 'about 70–150 MiB of memory', options: { fontSize: 21, breakLine: true, paraSpaceAfter: 10 } },
    { text: 'Once for the whole cluster: ', options: { bold: true, fontSize: 21, bullet: true } },
    { text: 'about 325 MiB', options: { fontSize: 21, breakLine: true, paraSpaceAfter: 10 } },
    { text: 'Each namespace using HTTP-level features: ', options: { bold: true, fontSize: 21, bullet: true } },
    { text: 'about 50 MiB', options: { fontSize: 21, breakLine: true, paraSpaceAfter: 10 } },
    { text: 'CPU for all of it together: ', options: { bold: true, fontSize: 21, bullet: true } },
    { text: 'about 1% of one core', options: { fontSize: 21, breakLine: true, paraSpaceAfter: 22 } },
    { text: 'Your application pods: unchanged.', options: { fontSize: 21, bold: true } },
  ],
  notes:
    'Platform-team-facing, and the numbers are real — measured on tallgeese (OSSM 3.4.2) on 2026-10-28, 7-day averages from cluster monitoring. Total is roughly 810 MiB and 9 millicores. Kiali (~335 MiB) is not included; it is the dashboard, not the mesh, and it is optional.\n\n' +
    'Be straightforward about the conditions: this cluster carries light demo traffic, so CPU is near its floor. CPU is the number that grows with traffic; memory moves much less. Do not extrapolate these to production sizing — if pressed, offer to follow up with Red Hat sizing guidance rather than improvising a number.\n\n' +
    'The point to land is the shape: a small fixed cost per node, one shared service per cluster, and an extra proxy only where a team turns on HTTP-level features. Nothing is added to the application pods, so the cost does not grow with the number of replicas.\n\n' +
    'RE-MEASURE BEFORE DELIVERING if the cluster has changed — query is in the outline appendix.',
});

contentSlide({
  title: 'Starting Is Reversible',
  body: [
    { text: 'Remove the label and traffic goes back to flowing directly.', options: { fontSize: 24, breakLine: true, paraSpaceAfter: 18 } },
    { text: 'Nothing to rewrite, nothing to unwind.', options: { fontSize: 24, breakLine: true, paraSpaceAfter: 28 } },
    { text: 'One namespace at a time. One team at a time.', options: { fontSize: 24, bold: true } },
  ],
  notes:
    'The objection in the room is "what if this goes wrong and I cannot get out." Answer it before it is asked. This is also the slide that makes "let us try it on one thing" a reasonable ask rather than a commitment.',
});

contentSlide({
  title: "What It Doesn't Do",
  body: bullets([
    'Not a replacement for authenticating your users — it authenticates your services.',
    'Not a fix for a slow database query.',
    'Not something you need if you have three services that barely talk.',
  ]).map((b) => ({ ...b, options: { ...b.options, fontSize: 22, paraSpaceAfter: 18 } })),
  notes:
    'Name the limits yourself. A room that has heard you say what something is not good for believes you about what it is. The third bullet matters — tell the small teams this is not for them yet, and the large ones will trust the rest of the deck.',
});

/* =====================  ACT 4  ===================== */

sectionSlide('What to Ask For');

{
  const s = pptx.addSlide({ masterName: 'TWO_CONTENT' });
  s.addText('Who Does What', { placeholder: 'title' });
  s.addText(
    [
      { text: 'Your platform team', options: { bold: true, fontSize: 21, color: RED, breakLine: true, paraSpaceAfter: 14 } },
      ...bullets(['Installs the mesh', 'Enrolls the namespace', 'Applies policy', 'Runs the dashboards', 'Owns upgrades']),
    ],
    { placeholder: 'left' },
  );
  s.addText(
    [
      { text: 'You', options: { bold: true, fontSize: 21, color: RED, breakLine: true, paraSpaceAfter: 14 } },
      ...bullets(['Name your ports', 'Keep readiness probes honest', 'Read the map', 'Say which calls should and should not be allowed']),
    ],
    { placeholder: 'right' },
  );
  s.addNotes(
    'Say out loud that both halves of that table are in this room. The point of the slide is that the developer half is small and the platform team half is work they are mostly already doing.',
  );
}

{
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText('The Conversation', { placeholder: 'title' });
  s.addShape(pptx.ShapeType.rect, { x: 0.7, y: 2.0, w: 11.9, h: 2.9, fill: { color: 'F5F5F5' }, line: { color: RED, width: 3 } });
  s.addText(
    '"Can we enroll <our namespace> in the mesh? We\'d like to start with visibility only — no policy — on <one service that isn\'t critical>. And we\'d like access to the dashboard."',
    { x: 1.1, y: 2.0, w: 11.1, h: 2.9, fontSize: 23, italic: true, valign: 'middle', color: INK },
  );
  s.addNotes(
    'Put a real namespace name in the brackets when you deliver it if you know one. The ask is deliberately small: visibility only, one non-critical service. A platform engineer can say yes to that in an afternoon, and "yes" is the outcome this whole deck exists to produce.',
  );
}

contentSlide({
  title: 'The First Week',
  body: [
    { text: 'Three things to look at:', options: { fontSize: 19, color: MUTED, breakLine: true, paraSpaceAfter: 20 } },
    ...bullets([
      'Does the map match what you thought your application does? (It usually does not.)',
      'Which calls are slower than you assumed?',
      "Which services talk to each other that shouldn't?",
    ]).map((b) => ({ ...b, options: { ...b.options, fontSize: 22, paraSpaceAfter: 18 } })),
  ],
  notes:
    'Every one of these produces a finding in the first week. Promising a specific, quick payoff is what keeps the request from dying after the meeting.',
});

contentSlide({
  title: 'Then What',
  body: [
    { text: 'One step at a time, in this order:', options: { fontSize: 19, color: MUTED, breakLine: true, paraSpaceAfter: 20 } },
    ...['Visibility — the map, the metrics, the traces', 'Encryption — already on, now you can prove it', 'A first rule about who may call what', 'Shifting traffic for a release'].map((t, i) => ({
      text: `${i + 1}.  ${t}`,
      options: { fontSize: 22, breakLine: true, paraSpaceAfter: 16 },
    })),
  ],
  notes:
    'Most teams stop happily after step 1 for a few months, and that is a fine place to stop. Say so — it lowers the stakes of starting.',
});

{
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText('Resources and Questions', { placeholder: 'title' });
  s.addText(
    bullets([
      'Red Hat OpenShift Service Mesh documentation',
      'This demo environment and its manifests: github.com/ultraJeff/ossm-3-demo',
    ]).map((b) => ({ ...b, options: { ...b.options, fontSize: 20 } })),
    { x: 0.7, y: 1.7, w: 7.4, h: 3.0 },
  );
  imagePlaceholder(s, 'PASTE: meetup QR code\n(from existing deck)', { x: 8.6, y: 1.7, w: 4.0, h: 4.0 });
  s.addNotes('Reuse the Raleigh RHUG QR from the existing introduction deck.');
}

/* ---------- write ---------- */

const out = 'Service Mesh for Developers.pptx';
pptx.writeFile({ fileName: out }).then(() => {
  console.log(`wrote ${out} — ${pptx.slides.length} slides`);
});
