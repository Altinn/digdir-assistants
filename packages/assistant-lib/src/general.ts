import * as url from "url";

export function env_full_name(varName: string): string {
  return (
    (process.env.DIGDIR_SLACK_BOT_PREFIX || "") +
    varName +
    (process.env.DIGDIR_SLACK_BOT_POSTFIX || "")
  );
}

export function envVar(varName: string, defaultValue: any = null): any {
  return process.env[env_full_name(varName)] || defaultValue;
}

export function envVarWithScope(
  varName: string,
  scopeName: string,
  defaultValue: any = null,
): any {
  let result: any;
  if (scopeName) {
    result = process.env[`${scopeName}_${varName}`];
  }

  if (!scopeName || result == undefined || result === null) {
    result = process.env[varName] || defaultValue;
  }

  if (
    varName != "LOG_LEVEL" &&
    envVarWithScope("LOG_LEVEL", scopeName) == "debug"
  ) {
    console.debug(`varName: ${varName}, scope: ${scopeName}, value: ${result}`);
  }
  return result;
}

export function scopedEnvVar(
  scopeName: string,
): (varName: string, defaultValue?: any) => any {
  return (varName: string, defaultValue: any | null = null): any => {
    return envVarWithScope(varName, scopeName, defaultValue);
  };
}

export function isValidUrl(urlString: string): boolean {
  try {
    const result = new url.URL(urlString);
    return !!(result.protocol && result.host);
  } catch (error) {
    return false;
  }
}

export function lapTimer(startTime: number): number {
  const stopTime = performance.now();

  return (stopTime - startTime) * 0.001;
}

export function round(num: number, decimals: number = 1): number {
  return Number(num.toFixed(decimals));
}

// Timer promise factory
export function timeoutPromise(timeoutMs: number) {
  const timeout = timeoutMs;

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${timeout} ms.`));
    }, timeout);
  });
}
