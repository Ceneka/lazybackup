export function parseRsyncOutput(output: string) {
  return {
    fileCount: parseNumberFromOutput(output, /Number of files: ([\d,]+)/),
    totalSize: parseNumberFromOutput(output, /Total file size: ([\d,]+)/),
    transferredSize: parseNumberFromOutput(output, /Total transferred file size: ([\d,]+)/)
  };
}

function parseNumberFromOutput(output: string, regex: RegExp): number {
  const match = output.match(regex);
  if (match && match[1]) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return 0;
}
