/** Emoji groups for the picker, like a phone keyboard. Plain characters: nothing is downloaded. */
export const EMOJI_GROUPS: { id: string; label: string; icon: string; emoji: string[] }[] = [
  {
    id: 'smileys', label: 'Smileys', icon: '😀',
    emoji: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😔 😪 🤤 😴 😷 🤒 🤕 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 🫡 🫠 🫢 🫣 🤝'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
  {
    id: 'people', label: 'Hands and people', icon: '👍',
    emoji: '👍 👎 👏 🙌 👐 🤲 🙏 ✍️ 💪 🦾 👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 ✊ 👊 🤛 🤜 🫶 👀 🧠 🗣️ 👤 👥 🧑‍💻 👩‍💻 👨‍💻 🧑‍🏫 👩‍🏫 👨‍🏫 🧑‍⚕️ 👩‍⚕️ 👨‍⚕️ 🧑‍🔬 🧑‍💼 👩‍💼 👨‍💼 🧑‍🎓 🧑‍🍳 🧑‍🔧 🧑‍🎨 🧑‍🚀 🙋 🙋‍♀️ 🙋‍♂️ 🤷 🤷‍♀️ 🤷‍♂️ 🙆 🙅 💁 🤦 🧘 🏃 🚶 👪'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
  {
    id: 'hearts', label: 'Hearts and symbols', icon: '❤️',
    emoji: '❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ✖️ ➗ ❓ ❔ ❗ ❕ ‼️ ⁉️ 💯 🔥 ✨ ⭐ 🌟 💫 ⚡ 💥 💢 💬 💭 🗯️ 🔔 🔕 📣 📢 ⚠️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻 🔸 🔹 ▶️ ⏩ ⏭️ 🔁 🔄 ➡️ ⬅️ ⬆️ ⬇️ ↗️ ↘️ 🆕 🆓 🆒 🔝 ™️ ©️ ®️'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
  {
    id: 'work', label: 'Work and ideas', icon: '💡',
    emoji: '💡 🎯 🚀 📈 📉 📊 💼 🗂️ 📁 📂 📅 📆 🗓️ ⏰ ⏱️ ⌛ ⏳ 📝 ✏️ 🖊️ 🖋️ 📌 📍 📎 🖇️ 🔗 📋 📄 📃 📑 🧾 📚 📖 📓 📒 📕 📗 📘 📙 🔖 🏷️ 💻 🖥️ ⌨️ 🖱️ 📱 ☎️ 📞 📧 📨 📩 📤 📥 📦 🗳️ 🔍 🔎 🔒 🔓 🔑 🛠️ 🔧 🔨 ⚙️ 🧰 🧲 🧪 🔬 🔭 🩺 💊 🏥 🏢 🏫 🏛️ 🏗️ 💰 💵 💳 🪙 📢 🎤 🎧 🎬 📷 📹 🎥 🧩 ♟️ 🏆 🥇 🥈 🥉 🏅 🎓'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
  {
    id: 'celebrate', label: 'Celebrate', icon: '🎉',
    emoji: '🎉 🎊 🥳 🎈 🎁 🎂 🍰 🧁 🥂 🍾 🎆 🎇 🪅 🎀 🏁 🚩 🎖️ 👑 💎 🌈 ☀️ 🌅 🌄 🌙 ⭐ 🌍 🌎 🌏 🗺️ ✈️ 🚗 🚲 🚆 ⛵ 🏖️ 🏝️ ⛰️ 🏔️ 🌋 🏕️'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
  {
    id: 'nature', label: 'Nature and food', icon: '🌱',
    emoji: '🌱 🌿 🍀 🌳 🌲 🌴 🌵 🌾 🌻 🌼 🌸 🌺 🌹 🌷 🍁 🍂 🍃 🌊 💧 ❄️ ☔ ⛅ 🌤️ 🐶 🐱 🦁 🐯 🐻 🐼 🐨 🐵 🦊 🐝 🦋 🐢 🐬 🦅 🦉 ☕ 🍵 🧃 🥤 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🥑 🥕 🌽 🍞 🧀 🍕 🍔 🍟 🌮 🍜 🍣 🍪 🍫 🍿'.split(' ').filter((e, i, all) => all.indexOf(e) === i),
  },
]

const RECENT_KEY = 'hiba.emoji.recent'

/** The emoji this person used most recently, newest first (kept only in this browser). */
export function recentEmoji(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 24) : []
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 24)))
  } catch {
    // Private mode: just not remembered.
  }
}

/**
 * Puts `insert` where the cursor is in a text box (or replaces the selected text) and returns the
 * new text and where the cursor should go, so typing carries on after the emoji.
 */
export function insertAtCursor(el: HTMLTextAreaElement | HTMLInputElement | null, value: string, insert: string) {
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? value.length
  return { text: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length }
}

/** Moves the cursor after React has put the new text in the box. */
export function placeCaret(el: HTMLTextAreaElement | HTMLInputElement | null, caret: number) {
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(caret, caret)
  })
}
