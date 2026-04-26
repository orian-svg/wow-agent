import "dotenv/config";

interface Config {
  port: number;
  anthropicApiKey: string;
  guestyClientId: string;
  guestyClientSecret: string;
  slackBotToken: string;
  slackChannelIsrael: string;
  slackChannelAthens: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config: Config = {
  port: parseInt(optionalEnv("PORT", "3000"), 10),
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
  guestyClientId: requireEnv("GUESTY_CLIENT_ID"),
  guestyClientSecret: requireEnv("GUESTY_CLIENT_SECRET"),
  slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
  slackChannelIsrael: optionalEnv("SLACK_CHANNEL_ISRAEL", "#wow-israel"),
  slackChannelAthens: optionalEnv("SLACK_CHANNEL_ATHENS", "#wow-athens"),
  logLevel: (optionalEnv("LOG_LEVEL", "info") as Config["logLevel"]),
};