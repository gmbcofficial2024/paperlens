export interface SseEvent {
  event?: string;
  data: string;
}

function parseEvent(block: string): SseEvent | undefined {
  const data: string[] = [];
  let event: string | undefined;

  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") data.push(value);
    if (field === "event") event = value;
  }

  if (data.length === 0) return undefined;
  return {
    ...(event ? { event } : {}),
    data: data.join("\n"),
  };
}

export class SseEventDecoder {
  private readonly decoder = new TextDecoder();
  private buffer = "";

  push(chunk: Uint8Array): SseEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): SseEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(flush: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    const boundary = /(?:\r\n|(?<!\r)\n|\r(?!\n)){2}/;

    while (true) {
      const match = boundary.exec(this.buffer);
      if (!match) break;

      const event = parseEvent(this.buffer.slice(0, match.index));
      this.buffer = this.buffer.slice(match.index + match[0].length);
      if (event) events.push(event);
    }

    if (flush && this.buffer) {
      const event = parseEvent(this.buffer);
      this.buffer = "";
      if (event) events.push(event);
    }

    return events;
  }
}

export interface SseDrainResult {
  data: string[];
  rest: string;
}

export function drainSseDataLines(buffer: string): SseDrainResult {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const data: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data: ")) continue;
    const value = line.slice(6).trim();
    if (value) data.push(value);
  }

  return { data, rest };
}
