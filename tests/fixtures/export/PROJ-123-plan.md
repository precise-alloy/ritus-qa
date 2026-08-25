# Test Plan — PROJ-123: Example checkout flow

- **Tracker:** Jira
- **Ticket URL:** https://example.test/browse/PROJ-123
- **Status / Type:** Ready for QA / Story
- **Date:** 2026-08-18
- **QA:** Jamie Doe

## Requirement Summary

Editors can configure the homepage CTA copy and destination in CMS.

The frontend must render the published values without truncating line breaks.

## Acceptance Criteria

- CTA copy updates after publish.
- CTA link points to the configured destination.

## Scope

### In Scope

- CMS editing for CTA content.
- Frontend rendering in the shared header.

### Out of Scope

- Analytics tagging validation.
- Downstream CRM form submission.

## Risks

CMS caching may delay published content for several minutes.

## Test Approach

Validate the authoring flow in CMS.

Cross-check published values in the frontend after cache clear.

## Environments

- **CMS (edit mode):** https://cms.example.test
- **Frontend:** https://www.example.test
- **Browsers:** Chrome, Edge
- **Design (Figma):** None
