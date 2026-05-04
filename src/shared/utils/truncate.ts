const DEFAULT_TRUNCATION_NOTICE = "\n\n... (truncated)";

export interface TruncateResult {
  text: string;
  wasTruncated: boolean;
}

export function truncateToBytes(
  text: string,
  maxBytes: number,
  notice: string = DEFAULT_TRUNCATION_NOTICE,
): TruncateResult {
  const byteLength = Buffer.byteLength(text, "utf-8");
  if (byteLength <= maxBytes) {
    return { text, wasTruncated: false };
  }

  const noticeBytes = Buffer.byteLength(notice, "utf-8");
  const safeLimit = maxBytes - noticeBytes;

  if (safeLimit < 0) {
    let lo = 0;
    let hi = notice.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (Buffer.byteLength(notice.slice(0, mid), "utf-8") <= maxBytes) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { text: notice.slice(0, lo), wasTruncated: true };
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf-8") <= safeLimit) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return { text: text.slice(0, low) + notice, wasTruncated: true };
}
