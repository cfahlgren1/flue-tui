import { defineAgent, defineTool, type AgentRouteHandler } from "@flue/runtime";
import * as v from "valibot";

export const description = "A demo assistant with dice and time tools.";

export const route: AgentRouteHandler = async (_c, next) => next();

const rollDice = defineTool({
  name: "roll_dice",
  description: "Roll one or more dice with a configurable number of sides.",
  input: v.object({
    sides: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(1000)),
      6,
    ),
    count: v.optional(
      v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)),
      1,
    ),
  }),
  run({ input }) {
    const rolls = Array.from(
      { length: input.count },
      () => Math.floor(Math.random() * input.sides) + 1,
    );

    return {
      rolls,
      total: rolls.reduce((total, roll) => total + roll, 0),
    };
  },
});

const getTime = defineTool({
  name: "get_time",
  description: "Get the current time in an optional IANA timezone.",
  input: v.object({
    timezone: v.optional(v.string()),
  }),
  run({ input }) {
    const now = new Date();

    let local: string;
    try {
      local = now.toLocaleString("en-US", {
        timeZone: input.timezone,
        timeZoneName: "short",
      });
    } catch {
      throw new Error(`Invalid timezone: ${input.timezone}`);
    }

    return `${local} (${now.toISOString()})`;
  },
});

export default defineAgent(() => ({
  model: process.env.DEMO_AGENT_MODEL ?? "anthropic/claude-haiku-4-5",
  instructions:
    "Be a friendly demo assistant and use your tools whenever the user asks for dice rolls or the current time.",
  tools: [rollDice, getTime],
}));
