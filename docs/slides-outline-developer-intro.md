# Service Mesh for Developers — Slide Outline

**Audience:** ~70 developers and developer-adjacent folks. A few have looked at service mesh before; most have very little idea what one does. Some of their platform engineers are in the room too.

**Length:** 45 minutes of slides, standing on their own. No demo required.

**The one goal:** every person walks out thinking *"I want to add a service mesh to the applications my team controls."*

That is a statement of desire, not of understanding. The deck is an argument, not a survey. Anything that doesn't move that argument forward gets cut, however interesting it is.

For the deep technical version of this material — ztunnel, HBONE, SPIFFE, the OVN-Kubernetes seam — see `slides-outline-architecture-deep-dive.md`. Do not borrow slides from it.

---

## Design rules

**Altitude.** If a slide can only be understood by someone who already knows what a proxy is, it's too deep. The audience's question is never "how does this work" — it's "what would this do for me, and what would it cost me."

**Vocabulary.** These words do not appear: *ambient, sidecar, ztunnel, waypoint, HBONE, SPIFFE, Envoy, data plane, control plane*. The mode is never named or compared — the deck describes behavior, and the behavior happens to be ambient. Say "the mesh" or "the platform." *Istio* appears exactly once (slide 6), as the open source project underneath, for credibility.

**One YAML slide.** Slide 19, and it is one line. Its whole rhetorical job is to be shorter than the audience expects. Every other slide is prose, a diagram, or a screenshot.

**No architecture diagram of the data plane.** Where the proxies run is not the audience's problem. If someone asks, answer in one sentence and move on.

**Before/after everywhere.** Each slide in Acts 2 and 3 names the thing they do today and the thing they'd do instead. The "before" has to be something they recognize from their own repo, or the "after" means nothing.

**Tone: understated.** State the thing and stop. Avoid stacked-negative sales cadence ("no code, no certs, no restarts") — it reads as a pitch and this audience discounts it. One plain sentence beats three emphatic ones.

**Screenshots over words** in Act 2. That act is carried by Kiali and trace views, not bullets.

---

## Act 1 — This is your problem, not the platform's
*≈10 minutes · 6 slides*

The job of this act is to make them feel a gap they already have, before any solution appears.

### Slide 1: Title
Service Mesh for Developers
What it is, and why you'd want one

Jeff Franklin · Senior Specialist Solution Architect · jefr@redhat.com

### Slide 2: Three Days to Find One Bad Hop
A checkout request fails. Intermittently. About 2% of the time.

Five services are involved. You have logs from all five. Every one of them reports that it did its job.

> Speaker notes: Open here, not on a definition. Tell it as something that happened, present tense. Ask for a show of hands: who has spent more than a day finding out which service in a chain was the broken one? Most of the room will raise a hand. That raised hand is the entire premise of the talk — don't rush past it.

### Slide 3: Look in Your Own Repo
Code that ships in your service and has nothing to do with your product:

- Retry logic, with somebody's guess at a backoff curve
- Timeout constants
- TLS setup between services
- Trace header propagation (and the one place it gets dropped)
- A circuit breaker, configured differently than the team next door's

Every team writes this. Every team writes it slightly differently.

> Speaker notes: This is the slide where they recognize themselves. Pause on it. The point isn't that the code is bad — it's that five teams wrote five versions of the same thing, and none of them are the product.

### Slide 4: Is This a *Micro* Service?
Reuse the diagram from the existing introduction deck (p. 5): a small box of business logic under a stack of authorization, authentication, tracing, metrics, fault tolerance, and routing.

> Speaker notes: The one slide in the old deck already pitched at exactly this altitude. It lands without explanation — let the picture do the work and move on.

### Slide 5: Three Questions You Can't Answer
About an application your team owns, right now:

- Who called this service in the last hour?
- Was that call encrypted?
- Which hop made the request slow?

> Speaker notes: Ask the room to answer for their own service. The honest answer to all three is usually "I'd have to go find out," and finding out means reading five repos. That gap is not a tooling failure — it's structural, which is the next slide.

### Slide 6: The Space Between Your Services
All three answers live in the same place: the network *between* services.

That's the one layer your code doesn't own and can't see.

A service mesh manages that layer, and hands the answers back to you. The one underneath OpenShift Service Mesh is the open source Istio project.

> Speaker notes: This is the hinge of the talk. Say "Istio" once, here, so the room knows this isn't a proprietary thing, then drop the word for the rest of the deck. Everything after this is "what the mesh gives you" and "what it costs you."

---

## Act 2 — What you'd get
*≈15 minutes · 9 slides*

The want engine. Screenshots carry this act. Keep each slide to roughly 90 seconds — the cumulative effect is what persuades, not any single item.

### Slide 7: Section divider — What You'd Get

### Slide 8: A Map You Didn't Draw
**Today:** an architecture diagram in Confluence, accurate as of eight months ago.
**Instead:** a live map, generated from actual traffic, showing what calls what right now.

Full-bleed Kiali graph screenshot. Minimal text.

> Speaker notes: The first time a team sees this, somebody says "wait, why does *that* call *that*?" That reaction is the sales pitch — mention that it happens, and that it's usually a surprise about their own app.
>
> **Optional demo pivot.** Live Kiali against the bookinfo namespace. The slide works alone if you skip it.

### Slide 9: Golden Signals, Per Service
**Today:** add a metrics library to each service, expose an endpoint, hope every team picked the same histogram buckets.
**Instead:** request rate, error rate, and latency percentiles for every enrolled service, in the same shape, whether or not anyone instrumented it.

> Speaker notes: Emphasize *same shape*. Comparable metrics across teams is the part that's hard to get any other way.

### Slide 10: Traces Without Instrumenting
**Today:** a tracing SDK in every service, context propagated by hand, one service drops the header and the trace ends there.
**Instead:** a span for every hop between services, automatically.

Trace waterfall screenshot.

> Speaker notes: Be honest here or you'll lose the skeptics — you still instrument inside your own code for business-level spans. What you get for free is every hop between services, which is exactly the part that was missing in the slide 2 story. Call that back explicitly.

### Slide 11: Every Call Encrypted
**Today:** TLS between internal services is a project nobody schedules. Certificates, rotation, a trust store per service.
**Instead:** mutual TLS on every call between enrolled services, with certificates issued and rotated for you.

> Speaker notes: For the compliance-minded in the room: this is encryption in transit inside the cluster, which is usually an audit finding somebody is carrying. Worth saying once, plainly.

### Slide 12: Identity Instead of IP Addresses
**Today:** "allow 10.128.0.0/16 to reach port 8080" — which is to say, allow everything.
**Instead:** "the checkout service may call the payment service" — by name, proven with a certificate, regardless of which node the pod landed on.

> Speaker notes: This is the conceptual leap of the whole talk, and it's worth its own slide. Identity stops being a location. Resist the urge to name the standard behind it.

### Slide 13: Who Can Call What
**Today:** a firewall ticket, a two-week wait, and a rule written in addresses nobody can read six months later.
**Instead:** start from "nothing may call this," then allow the specific services that should — expressed in the names your team already uses.

> Speaker notes: Developers rarely ask for this, but they recognize the ticket. Platform engineers in the room will perk up here — this is the slide that makes the mesh their win too.

### Slide 14: Ten Percent to the New Version
**Today:** a feature flag in the code, or a second deployment and a pipeline stage to manage it.
**Instead:** send 10% of real traffic to v2 and the rest to v1. Watch the error rate. Move the number.

> Speaker notes: No new build, and no code path that has to be cleaned up afterwards. For teams doing trunk-based development this is often the single most wanted item in the deck.
>
> **Optional demo pivot.** The canary rollout against the REST API demo.

### Slide 15: Failures You Didn't Handle
**Today:** a resilience library per language, configured to a different standard on each team.
**Instead:** retries, timeouts, and pulling a failing instance out of rotation, applied uniformly at the network layer.

> Speaker notes: Say the honest caveat: this covers transport-level failure, not a bug in your business logic, and it doesn't excuse you from thinking about idempotency. Saying so costs nothing and buys credibility for Act 3.

---

## Act 3 — What it costs you
*≈12 minutes · 8 slides*

The credibility act. It reads as a cost disclosure to developers, and it is quietly aimed at the platform engineers in the room, who are the people who have to say yes. Do not rush it — this act is what converts interest into a request.

### Slide 16: Section divider — What It Costs You

### Slide 17: What Changes in Your Code
Nothing.

> Speaker notes: One word on the slide. Let it sit for a beat before explaining — the silence does more than a bullet list would. Then one sentence: there's no library to add, in any language.

### Slide 18: What Changes in Your Deployment
Nothing.

Your Deployment, your Service, your container image — unchanged. Nothing is injected into your pod.

> Speaker notes: The second "nothing" is the one that surprises people who looked at service mesh a few years ago and remember it rewriting their pod spec. If anyone in the room has that memory, this is the slide that updates it. You don't need to explain what changed, only that it did.

### Slide 19: How Your App Joins
The only configuration in this deck:

```
oc label namespace my-app istio.io/dataplane-mode=ambient
```

Somebody with namespace permissions applies that. Your running pods join the mesh.

> Speaker notes: The rhetorical point is length — it's one line, and it's the last line of YAML in the talk.
>
> **On the word `ambient`:** it's unavoidable here, it's the literal label value. Don't draw attention to it. If someone asks, one sentence: "that's the name of the data plane mode — it's how the mesh runs now." Then move on; the comparison to the older model is not a conversation worth having in this room.
>
> **Optional demo pivot.** Enroll a namespace live and show the pods staying 1/1 through it.

### Slide 20: What You Do Need to Do
Three things that actually bite:

- **Name your ports.** A Service port called `http` or `grpc` gets L7 features. An unnamed one is treated as opaque TCP.
- **Talk to Services, not pod IPs.** Anything hard-coded to an address bypasses the mesh.
- **Keep readiness probes honest.** The mesh routes on them.

> Speaker notes: This is the real homework, and it's short. Naming ports is the one that catches teams most often. Being specific here is what makes the earlier "nothing changes" claims believable rather than glib.

### Slide 21: What It Costs the Cluster
Measured on our demo cluster — 3 nodes, 17 application pods, averaged over a week:

- **On every node:** about 70–150 MiB of memory
- **Once for the whole cluster:** about 325 MiB
- **Each namespace using HTTP-level features** (routing, retries, the 10% split): about 50 MiB
- **CPU for all of it together:** about 1% of one core

Your application pods: unchanged.

> Speaker notes: Platform-team-facing, and the numbers are real — measured on tallgeese (OSSM 3.4.2) on 2026-10-28, 7-day averages from cluster monitoring. Total is roughly 810 MiB and 9 millicores. Kiali (~335 MiB) is not included; it's the dashboard, not the mesh, and it's optional.
>
> Be straightforward about the conditions: this cluster carries light demo traffic, so CPU is near its floor. CPU is the number that grows with traffic; memory moves much less. Don't extrapolate these to production sizing — if pressed, offer to follow up with Red Hat's sizing guidance rather than improvising a number.
>
> The point to land is the shape: a small fixed cost per node, one shared service per cluster, and an extra proxy only where a team turns on HTTP-level features. Nothing is added to the application pods, so the cost doesn't grow with the number of replicas.
>
> **Re-measure before delivering** if the cluster has changed — see the query in the presenter appendix.

### Slide 22: Starting Is Reversible
Remove the label and traffic goes back to flowing directly. Nothing to rewrite, nothing to unwind.

One namespace at a time. One team at a time.

> Speaker notes: The objection in the room is "what if this goes wrong and I can't get out." Answer it before it's asked. This is also the slide that makes "let's try it on one thing" a reasonable ask rather than a commitment.

### Slide 23: What It Doesn't Do
- Not a replacement for authenticating your *users* — it authenticates your *services*.
- Not a fix for a slow database query.
- Not something you need if you have three services that barely talk.

> Speaker notes: Name the limits yourself. A room that has heard you say what something isn't good for believes you about what it is. The third bullet matters — tell the small teams this isn't for them yet, and the large ones will trust the rest of the deck.

---

## Act 4 — What to ask for
*≈8 minutes · 6 slides*

They can't enroll a namespace themselves. This act gives them the sentence to say to the people who can — who are, conveniently, in the room.

### Slide 24: Section divider — What to Ask For

### Slide 25: Who Does What
Two columns.

**Your platform team:** installs the mesh, enrolls the namespace, applies policy, runs the dashboards, owns upgrades.

**You:** name your ports, keep readiness probes honest, read the map, and say which calls should and shouldn't be allowed.

> Speaker notes: Say out loud that both halves of that table are in this room. The point of the slide is that the developer's half is small and the platform team's half is work they're mostly already doing.

### Slide 26: The Conversation
Close to verbatim:

> "Can we enroll `<our namespace>` in the mesh? We'd like to start with visibility only — no policy — on `<one service that isn't critical>`. And we'd like access to the dashboard."

> Speaker notes: Put a real namespace name in the brackets when you deliver it if you know one. The ask is deliberately small: visibility only, one non-critical service. A platform engineer can say yes to that in an afternoon, and "yes" is the outcome this whole deck exists to produce.

### Slide 27: The First Week
Three things to look at:

- Does the map match what you thought your application does? (It usually doesn't.)
- Which calls are slower than you assumed?
- Which services talk to each other that shouldn't?

> Speaker notes: Every one of these produces a finding in the first week. Promising a specific, quick payoff is what keeps the request from dying after the meeting.

### Slide 28: Then What
One step at a time, in this order:

1. Visibility — the map, the metrics, the traces
2. Encryption — already on, now you can prove it
3. A first rule about who may call what
4. Shifting traffic for a release

> Speaker notes: Most teams stop happily after step 1 for a few months, and that's a fine place to stop. Say so — it lowers the stakes of starting.

### Slide 29: Resources and Questions
- Red Hat OpenShift Service Mesh documentation
- This demo environment and its manifests: `github.com/ultraJeff/ossm-3-demo`
- Meetup QR code (reuse from the existing deck)

---

## Appendix for the presenter — current facts

Not slides. Here so nothing in the deck goes stale the way the last one did, and so questions from the floor get accurate answers.

As of October 2026, verified against the demo cluster:

| | Version |
|---|---|
| OpenShift Service Mesh | 3.4.2 |
| Istio | 1.30.3 |
| Kiali | 2.27.4 |
| OpenShift | 4.22.8 |

- The sidecar-less data plane has been **generally available since OpenShift Service Mesh 3.2**. It was developer preview in 3.0 and technology preview in 3.1 — if anyone in the room remembers it as "preview," that's why, and it's out of date.
- **Running both models in one mesh is supported as of 3.4**, as is a documented, gradual, reversible migration from the older one. Useful if a platform engineer asks whether they have to move everything at once. They don't.
- **Gateway API is GA on OpenShift as of 4.19**, with the Ingress Operator managing the CRD lifecycle. The older "you have to install the CRDs yourself" answer is out of date.
- Supported on FIPS-mode clusters as of 3.3.
- OpenShift Service Mesh 2.6 reached end of life on 30 June 2026.

### Re-measuring slide 21

7-day average memory (MiB) per mesh pod, from the Thanos querier with an admin token. Repeat with `rate(container_cpu_usage_seconds_total{...}[7d]) * 1000` for millicores.

```
sum by (pod) (avg_over_time(container_memory_working_set_bytes{container!="",container!="POD",namespace=~"ztunnel|istio-cni|istio-system"}[7d])) / 1048576
sum by (pod) (avg_over_time(container_memory_working_set_bytes{container!="",container!="POD",pod=~".*waypoint.*"}[7d])) / 1048576
```

Measured 2026-10-28: per node 11–30 MiB (node proxy) + 59–121 MiB (network setup); istiod 324 MiB; four waypoints 44–55 MiB each; ~9 millicores total.
