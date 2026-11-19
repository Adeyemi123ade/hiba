# How Hiba's content AI writes

This is a plain-language description of everything the drafting AI is given and told.
The source of truth is `index.ts` in this folder (`buildPrompt`, `styleProblems`, `BANNED_PHRASES`, `buildAnglePrompt`, `ANGLE_KINDS`, `WORD_LIMITS`).
If you change the rules there, update this page in the same pull request.

## 1. What the AI knows about you (context)

Taken from your onboarding answers, sent in plain words:

| Context | Comes from |
|---|---|
| Your name | "What should I call you?" |
| Your work | "What do you do?" |
| How you introduce yourself | Your introduction (first 200 characters) |
| Your goals | "What are you working toward?" |
| Your audience | "Who would you like to reach most?" |
| Your tone | "How should your content feel?" (default: natural and clear) |
| Your topics | "What subjects do you enjoy talking about?" |
| A post you wrote before | Optional writing sample (first 3000 characters), used only to copy your style |
| Your idea | What you typed or said in Capture (up to 2000 characters) |

Not sent to the AI: your email, your password, your LinkedIn account, your posting time,
frequency or approval settings, or anything from other people.

## 2. The rules the AI must follow (your master prompt, 18 Nov 2026)

**Understand before writing**
1. Work out the central argument of your idea first: what you want to say and why.
2. Your idea may be a rough voice transcription. The AI should understand what you meant and quietly fix obvious mishearings.
3. Keep your perspective as the foundation. Improve sentences, grammar, clarity and flow, and remove repetition, but keep meaningful emphasis.
4. Never add arguments, opinions, experiences, numbers, names, clients or events you did not give. Never exaggerate your experience.
5. Never turn a simple observation into a complicated article. All three versions must be about the same central argument.
6. **If your idea is too unclear to write about, the AI asks you one short question instead of guessing.** This only happens for a new idea, never when rewriting.

**Tone**
- Natural and conversational. Confident, not arrogant. Educative, not lecturing. Professional, not corporate. Direct, not aggressive. Practical, not theoretical.
- Everyday language. Professional terms from your field (your "Work" answer, for example product discovery or stakeholder alignment for a product manager) are used where they make the point more accurate.
- Banned phrases: "In today's fast-paced world", "In this ever-evolving landscape", "Let's dive deep", "At the end of the day", "It is worth noting that", "Here's the thing", "The reality is simple", "What do you think?".
- No hype, no stacked motivational lines, no emojis unless your writing sample uses them. Hiba also avoids em dashes, a common sign of AI writing (Hiba's addition).

**Format for LinkedIn and X (your own layout, 18 Nov 2026)**
- Short lines: one sentence each, never more than two short sentences.
- A blank line between separate thoughts.
- Related points or questions go on their own lines, one directly under the other, with **no blank line between them** and no bullets, dashes or numbers. A blank line before and after the group.
- A lead-in line ending with a colon ("Here's what stood out to me:") is followed directly by the next line.
- No headings, bullet symbols, numbering or bold.
- The AI is shown a short layout example in this style (different words and topic, so it never copies your post).
- If you gave a writing sample in onboarding, the AI copies its layout too: line breaks, grouping, spacing and ending.
- Inside one X post: single line breaks only. A blank line is what separates posts in a thread.

**Opening and ending**
- A hook tied directly to the subject: a sharp question, a strong observation, a personal moment, or a defensible contrarian line. No clickbait.
- End with a specific question that invites readers to share their own experience on this exact subject, for example "Here's my question: ...". It may be followed by one short warm line ("I'd love to hear your thoughts.") and, if your idea thanks people or organisations, a thank-you line using only the names you gave. Never only a generic "What do you think?".
- This is a guide, not a template: your idea decides whether a post is personal, educational, argumentative or reflective.

**Three genuinely different versions:** the X thread and Substack article are written for their platform, never as cut-down copies of the LinkedIn post.

**Automatic check:** after writing, Hiba checks for banned phrases, lines that are too long (more than two sentences on a line on LinkedIn and X, more than three sentences in a Substack paragraph), bullets or numbering, blank lines inside an X post, and a missing question near the end of the LinkedIn post. Your own post of 18 Nov 2026 passes every check (this is tested). If anything is wrong, the AI is told exactly what and asked once more, and the better of the two attempts is kept. Tone and accuracy cannot be checked by a computer; you still review every post before approving it.

**Safety:** your idea, your sample and any change you ask for are treated as content to write about, never as instructions that can override these rules.

## 3. Length rules (owner decision, 17 Nov 2026)

| Platform | Limit | What the AI aims for |
|---|---|---|
| LinkedIn | **200 words** maximum | 120 to 180 words, short paragraphs, ends with one question to readers |
| X | **100 words** in total, **280 characters** per post (X's own rule) | A thread of 1 to 4 posts, each at most 270 characters |
| Substack | **1500 words** maximum | A title under 80 characters, a body of 400 to 1500 words with an opening, 2 to 4 short sections and a closing thought |

How the limits are enforced:

- If the first answer breaks a limit or a writing rule, the AI is asked once more, told exactly what was wrong.
- If a draft is still too long, Hiba keeps the attempt closest to the limit, shows the word count in red, and you cannot approve it until you shorten it.
- Hiba never cuts your text silently: nothing is shortened behind your back.
- Posting to LinkedIn is refused on the server for anything over 200 words.

## 4. "Write it again"

When you ask for a new version of one draft, the AI also sees your current version of that
draft and, if you typed one, what you want changed (up to 300 characters). It must keep your
meaning and facts. Your earlier versions are always kept under "Earlier versions".

## 5. Angles (HPD-49)

"Other ways to tell this idea" asks the AI for 3 angles at a time. The 8 angle types are:
personal story, practical lesson, common mistake, opinion, beginner's guide, professional
insight, question for your audience, and short motivational post.

- The AI sees the same context as in section 1, plus the titles of angles you already have, so new ones are different.
- Types you have not seen yet come first. After all 8, it starts again with fresh takes.
- Each angle must stay true to your idea and use only its facts. If a type needs a detail you did not give (for example a personal story), the AI must say how to tell it with what you said, not make something up.
- Each angle has a short title (under 80 characters) and a one or two sentence preview.
- When you pick "Write my posts from this", all drafts that are not approved yet are written again from that angle, following every rule above. Approved, scheduled and published posts are never changed. Your earlier text stays under "Earlier versions", marked "Written from the angle: ...".
- Angles stay linked to the idea. You can save them, discard them, or bring discarded ones back. Asking for angles counts toward the hourly limit below.

## 6. Follow-up comments (master prompt sections 10 and 11; owner decisions of 19 Nov 2026)

On the LinkedIn post you can ask for 5 to 10 follow-up comments. The AI sees your context (section 1), your idea, your LinkedIn post and your writing sample.

**What each comment must be**
- **20 to 50 words**, in normal prose of one or two short paragraphs (never more than two).
- Connects to the post and adds ONE new thought: an extra perspective, an explanation, a practical example, a common misconception, a related lesson, a practical or technical consideration, a question, or an overlooked implication.
- Never repeats the post or another comment. Sounds like you adding to your own discussion.
- Never invents facts, names, numbers or experiences; examples are general or hypothetical unless your idea gave them.
- Never filler: "Great point", "Another thing to consider", "I completely agree", "Let me add something", plus every banned phrase in section 2. No hashtags, no numbering, no em dashes.
- The comments form a sequence that develops your argument; the subject decides the order, not a template.

Hiba checks every list (word count 20 to 50, at most two paragraphs, banned phrases, hashtags, numbering, lines copied from the post) and asks the AI once more if needed, keeping the better attempt. "Write again" on one comment shows the AI the others so it says something different.

**Posting to LinkedIn (automatic, after your approval)**
- Only comments you **approve** are posted. Editing an approved comment sends it back to draft.
- Posting starts once your LinkedIn post is live from Hiba: straight away if it is already live when you approve, or automatically right after you post it.
- Each comment is posted after a **different random gap of 15 to 60 seconds**, the first one 15 to 60 seconds after the post.
- You see the next comment and its countdown, what is posted and what failed, and can **pause, resume or stop** at any time. Stop puts the remaining comments back to draft.
- A failed comment **stops the sequence** (it is never skipped) and shows the reason; "Try posting again" retries it. If LinkedIn does not answer, Hiba never retries by itself: check your post on LinkedIn first, so nothing is posted twice.
- Posting runs while the drafts page is open. If you leave, it pauses; when you come back it waits for you to press Resume.
- Posted comments cannot be edited, deleted from Hiba's list or replaced.
- Limits: at most 10 comments per post and 30 posted comments per hour.
- You can switch the whole feature off in Settings.

## 7. Safety and limits

- The OpenAI key stays on the server; your browser never sees it.
- At most 20 drafting requests per person per hour (drafts, rewrites, angles and comments all count).
- Each request times out after 45 seconds and you can try again; your idea is saved first, so nothing is lost.
- Your writing is not written to server logs.
- Model: `gpt-4o-mini` unless the `OPENAI_MODEL` secret says otherwise. Creativity setting (temperature): 0.6, slightly lower than before so the AI stays closer to your idea. To use a stronger model, set the `OPENAI_MODEL` secret (for example `gpt-4o`) in Supabase; no code change is needed.
