import { CONTACT_EMAIL, GOVERNING_LAW, OPERATOR } from '@/lib/legal'

export type LegalSection = [heading: string, paragraphs: string[]]

// Last reviewed 22 Nov 2026 (HPD-156): images on the device, voice transcription, usage records,
// LinkedIn as the only connected account, and Delete account in Settings (HPD-157).
export const PRIVACY: LegalSection[] = [
  ['1. Who we are', [`Hiba ("Hiba", "we", "us") is an AI-assisted tool that helps professionals turn their ideas into posts for LinkedIn, X and Substack. Hiba is operated by ${OPERATOR}, based in Nigeria, who is responsible for your personal information. This policy explains what personal information we collect, why, and the choices you have.`, `Contact for all privacy questions: ${CONTACT_EMAIL}.`]],
  ['2. Information we collect', [
    'Account: your email address and password (stored only as a secure hash by our authentication provider, never in plain text). If you use Google sign-in, we receive your name and email from Google.',
    'Profile and onboarding answers: your name, profession, goals, audience, tone, topics, platforms, posting frequency, approval preference, and any writing samples you choose to share.',
    'Your content: ideas you type or speak, transcripts, drafts, posts, comments and schedules.',
    'Images and files: your image library is kept on your own device, not on our servers (see section 10). When you add an image, video or document to a post, Hiba keeps a private copy until the post is published, so scheduled posts can go out while your device is off.',
    'Connected accounts: if you connect LinkedIn, the access tokens and profile identifiers needed to post on your behalf, and basic performance figures where LinkedIn provides them. LinkedIn is the only account you can connect; drafts for X and Substack are copied out and posted by you.',
    'Usage records: how many drafts, rewrites, transcriptions and other AI requests you make, and their estimated cost, so we can apply daily limits and keep Hiba affordable.',
    'Technical data: IP address, browser and device type, and logs used for security and troubleshooting.',
  ]],
  ['3. Voice input', ['When you record a voice note, the recording is sent to OpenAI to be turned into text. Hiba does not store the recording or write it to logs; only the resulting text is kept, as one of your ideas. You can use Hiba without voice by typing instead.']],
  ['4. How we use your information', ['To create and secure your account; to generate drafts in your voice; to schedule and publish posts only as you approve or configure; to apply daily limits; to provide support; to keep the service safe and working; to improve Hiba; and to meet legal obligations.', 'We do not sell your personal information. We do not use your content to train AI models ourselves. Hiba does not generate images.']],
  ['5. Service providers we rely on', ['Supabase (database, file storage and authentication); Vercel (hosting the app); OpenAI (generating drafts from your ideas and turning voice notes into text); Resend (sending verification and password emails); and LinkedIn, only when you connect it or publish to it. Your content is sent to our AI provider to produce drafts, under its own terms. At the time of writing, content sent through its business API is not used to train its models by default; please review its current policy. Each provider processes data only to deliver its service to us.']],
  ['6. Legal bases', ['Where laws such as the GDPR or the Nigeria Data Protection Act apply, we process data to perform our agreement with you, with your consent (for example when you connect an account), for our legitimate interests in running a secure service, and to comply with the law.']],
  ['7. International transfers', ["Your information may be processed in countries other than your own, including the European Union and the United States. We rely on our providers' contractual safeguards for these transfers."]],
  ['8. How long we keep it', [
    'We keep your information while your account is active.',
    'Images and files on a post: our copy is deleted after the post is published to LinkedIn, or when you remove it from a draft. Your image library stays on your device until you delete it there.',
    "Deleting your account: you can do this yourself in Settings, under Delete account. Your account, content, usage records, connected accounts and stored files are deleted straight away, except where the law requires us to keep something. Copies in our providers' backups, if any, expire within 90 days. We keep only a count of deletions, with the date, and nothing that identifies you.",
    'Connected-account tokens are removed when you disconnect or delete your account. Posts already published stay on LinkedIn until you delete them there.',
  ]],
  ['9. Your rights', [
    'You can access, correct, export or delete your information, object to or restrict its use, and withdraw consent at any time.',
    'You can correct your details in Settings, and delete your account in Settings under Delete account. For a copy of your data, or any other request, email us and we will reply within 30 days. You may also complain to your data protection authority.',
  ]],
  ['10. Cookies and browser storage', [
    'We use essential browser storage to keep you signed in and to keep unsaved drafts on your device.',
    "Your image library is stored in your browser on this device. It does not appear on your other devices, and clearing this browser's data, uninstalling it or losing the device removes it. We cannot recover it for you.",
    'We do not use advertising cookies.',
  ]],
  ['11. Security', ['Data is encrypted in transit, LinkedIn tokens are encrypted when stored, and database rules ensure you can only access your own data and files. No system is perfectly secure. If a breach affects you we will notify you as the law requires.']],
  ['12. Children', ['Hiba is for people aged 18 and over. We do not knowingly collect information from children.']],
  ['13. Changes to this policy', ['If we make important changes we will update the date above and tell you in the app or by email.']],
  ['14. Contact', [`Questions or requests: ${CONTACT_EMAIL}.`]],
]

export const TERMS: LegalSection[] = [
  ['1. Agreement', [`These Terms are an agreement between you and ${OPERATOR} ("Hiba", "we", "us"). By creating an account or using Hiba you agree to these Terms and to our Privacy Policy. If you do not agree, please do not use Hiba.`]],
  ['2. The service', ['Hiba helps you capture ideas, draft posts with AI, add your own images and files, and schedule or publish posts to LinkedIn. You can also have drafts written for X and Substack and post them yourself. Hiba does not generate images. Features may change as the product develops.']],
  ['3. Eligibility', ['You must be at least 18 and able to enter a binding agreement.']],
  ['4. Your account', ['Give accurate information, keep your password secure, and tell us promptly if you suspect unauthorised access. You are responsible for activity on your account.']],
  ['5. Your content and AI output', ['You own the content you provide, including your images and files. You give us a limited licence to host, process and transmit it only to run Hiba, for example to generate drafts and to publish when you ask. Only add images and files you have the right to use.', 'AI-generated drafts can contain mistakes or resemble existing material. You are responsible for reviewing anything before it is published under your name, and for making sure it is accurate and lawful.']],
  ['6. Connected platforms', ['LinkedIn is currently the only account you can connect. LinkedIn, X, Substack and similar services have their own terms, which you must follow. You authorise Hiba to post on LinkedIn on your behalf only as you approve or configure. Platforms may limit or end access at any time, and we are not responsible for their decisions. You can disconnect at any time.']],
  ['7. Automatic posting', ['If you choose a mode that publishes without per-post approval, you accept that posts will go out on your schedule without a separate review.']],
  ['8. Acceptable use', ["Do not use Hiba to break the law, infringe others' rights, harass or deceive people, send spam, spread malware, impersonate others, scrape or overload the service, or bypass security. We may suspend accounts that do."]],
  ['9. Our intellectual property', ["Hiba's software, design and brand belong to us. You may not copy or resell them without permission."]],
  ['10. Fees', ['Hiba is currently free during early access, with daily limits on AI requests. If we introduce paid plans we will tell you first and you will not be charged without agreeing.']],
  ['11. Availability', ['Hiba is provided as is and may be interrupted for maintenance or other reasons. We do our best to keep it running but cannot promise it will always be available.']],
  ['12. Ending your use', ['You can stop using Hiba and delete your account at any time in Settings, under Delete account. Deletion is permanent and cannot be undone. We may suspend or end access if you break these Terms or the law. Sections that by their nature should continue will continue after termination.']],
  ['13. Disclaimers', ['We do not promise any particular result, such as audience growth or engagement, and we do not guarantee that AI output is accurate, original or suitable for your purpose.']],
  ['14. Limit of liability', ['To the maximum extent the law allows, we are not liable for indirect or consequential loss, and our total liability for any claim is limited to the greater of what you paid us in the previous 12 months or US$50. Nothing here limits liability that cannot be limited by law.']],
  ['15. Your responsibility', ['You agree to cover losses we suffer because you broke these Terms or posted unlawful content using Hiba.']],
  ['16. Governing law', [`These Terms are governed by the laws of ${GOVERNING_LAW}, without regard to conflict-of-law rules. Where consumer law gives you the right to use your local courts, that right is not affected.`]],
  ['17. Changes', ['We may update these Terms. If the changes are important we will tell you in the app or by email, and continued use means you accept them.']],
  ['18. Contact', [`Questions about these Terms: ${CONTACT_EMAIL}.`]],
]
