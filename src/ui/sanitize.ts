const ESC = 0x1b;
const BEL = 0x07;
const STRING_TERMINATOR = 0x9c;

function codePointEnd(value: string, index: number): number {
  if (index >= value.length) {
    return value.length;
  }
  const codePoint = value.codePointAt(index);
  return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}

function skipControlSequence(value: string, start: number): number {
  for (let index = start; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index + 1;
    }
  }
  return value.length;
}

function skipStringSequence(
  value: string,
  start: number,
  allowBellTerminator: boolean,
): number {
  for (let index = start; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (allowBellTerminator && code === BEL) {
      return index + 1;
    }
    if (code === STRING_TERMINATOR) {
      return index + 1;
    }
    if (
      code === ESC &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) === 0x5c
    ) {
      return index + 2;
    }
  }
  return value.length;
}

function skipEscSequence(value: string, escapeIndex: number): number {
  const introducerIndex = escapeIndex + 1;
  if (introducerIndex >= value.length) {
    return value.length;
  }

  const introducer = value.charCodeAt(introducerIndex);
  if (introducer === 0x5b) {
    return skipControlSequence(value, introducerIndex + 1);
  }
  if (introducer === 0x5d) {
    return skipStringSequence(value, introducerIndex + 1, true);
  }
  if (
    introducer === 0x50 ||
    introducer === 0x5f ||
    introducer === 0x58 ||
    introducer === 0x5e
  ) {
    return skipStringSequence(value, introducerIndex + 1, false);
  }
  if (introducer === 0x4e || introducer === 0x4f) {
    return codePointEnd(value, introducerIndex + 1);
  }

  // ESC sequences with intermediate bytes end at the next final byte.
  if (introducer >= 0x20 && introducer <= 0x2f) {
    for (let index = introducerIndex + 1; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0x30 && code <= 0x7e) {
        return index + 1;
      }
    }
    return value.length;
  }

  // Other two-byte escape functions, such as RIS (ESC c).
  return introducerIndex + 1;
}

/** Remove terminal control functions while preserving readable line structure. */
export function sanitizeText(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; ) {
    const code = value.charCodeAt(index);
    if (code === ESC) {
      index = skipEscSequence(value, index);
      continue;
    }

    // Strip C0 controls except horizontal tab and line feed.
    if (code <= 0x1f) {
      if (code === 0x09 || code === 0x0a) {
        result += value[index];
      }
      index++;
      continue;
    }

    // Strip the equivalent single-byte C1 terminal controls as well.
    if (code === 0x9b) {
      index = skipControlSequence(value, index + 1);
      continue;
    }
    if (code === 0x9d) {
      index = skipStringSequence(value, index + 1, true);
      continue;
    }
    if (code === 0x90 || code === 0x9f || code === 0x98 || code === 0x9e) {
      index = skipStringSequence(value, index + 1, false);
      continue;
    }
    if (code === 0x8e || code === 0x8f) {
      index = codePointEnd(value, index + 1);
      continue;
    }
    if (code >= 0x80 && code <= 0x9f) {
      index++;
      continue;
    }

    result += value[index];
    index++;
  }

  return result;
}
