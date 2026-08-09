# Hiba

AI Personal Brand Operating System for content creators. Captures ideas,
turns them into posts that sound like the creator, and publishes on a
schedule (autonomously or with approval), even while the creator is offline.

This is a standalone product with no dependency on any other project.

## Stack

React 18 + TypeScript, Vite, Tailwind CSS v4, TanStack Query (server state),
Zustand (UI state), React Router v6, Supabase (auth, database, storage,
realtime, edge functions). See `Technical_architecture.png` / `System_Architecture.png`
in the project artifacts for the full picture.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase project URL + anon key
npm run dev
```

## Source of truth

`Product_Blueprint_AI_Personal_Brand_Operating_System.md` is the PRD.
UI/UX and architecture artifacts (Design System, Component Library,
Accessibility Guidelines, Front-end/System/Technical Architecture,
Responsive Layout, Motion & Micro-interaction System) govern implementation
details. Where artifacts disagree, the Technical/System Architecture docs
are the tiebreaker.

## Status

Foundation scaffold only. Screens are being built out feature by feature
as designs arrive.
