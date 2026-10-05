"use client";

import { SAMPLE_SOUNDS, SYNTH_SOUNDS } from "@/lib/sound";
import type { SoundDef } from "@/lib/types";

/** <select> 안에 넣는 소리 목록 — 녹음 음원 / 합성음 / 내 사운드로 묶는다 */
export function SoundOptions({ custom }: { custom: SoundDef[] }) {
  return (
    <>
      <optgroup label="녹음 음원">
        {SAMPLE_SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.emoji} {s.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="합성음">
        {SYNTH_SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.emoji} {s.name}
          </option>
        ))}
      </optgroup>
      {custom.length > 0 && (
        <optgroup label="내 사운드">
          {custom.map((s) => (
            <option key={s.id} value={s.id}>
              {s.emoji} {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
