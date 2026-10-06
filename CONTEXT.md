# PaperLens

PaperLens augments a readable browser page with an adjacent translation and an optional full-page summary while preserving the reader's place in the original document.

## Language

**Live Anchor**:
An original page element that represents one translatable passage and preserves the location where its translation belongs.
_Avoid_: Parsed paragraph, cloned paragraph, text block

**Candidate Evidence**:
A signal from a content-discovery strategy that a page element may be a Live Anchor; multiple signals may describe the same element.
_Avoid_: Parsed result, final paragraph

**Semantic Section**:
One occurrence of a meaningful heading and the ordered Live Anchors associated with it. Repeated heading text denotes distinct Semantic Sections when it occurs at different positions.
_Avoid_: Heading bucket, section name

**Page Reading Session**:
The lifetime of PaperLens activity attached to one page identity, including summary, translation, and their combined usage. It ends when that page is replaced or explicitly reset.
_Avoid_: Content session, translation session

**Page Usage**:
The combined model usage produced by summary and translation during one Page Reading Session.
_Avoid_: Translation usage, widget total

**Provider Draft**:
The raw, unsaved credential, model, and endpoint values being edited for one translation provider.
_Avoid_: Provider settings, saved key

**Saved Settings Baseline**:
The last successfully persisted and normalized settings from which Provider Drafts begin.
_Avoid_: Draft, defaults

**Local Settings**:
Settings saved for one installed extension identity in one browser profile and not synchronized to another profile or installation.
_Avoid_: Account settings, synced settings
