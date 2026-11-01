// A copy of the AmplifAI tool's guide schema (juulvs/amplifai, src/features/guides/schemas.ts, TypeScript types
// removed), so the tests can check that every guide the engine returns saves in the tool as it is.
// When the tool changes its schema, copy it here again.
import { z } from "zod";

export const guideLimits = {
  intro: 2000,
  tips: { min: 1, max: 5, length: 1000 },
  questions: { max: 3, length: 300 },
  answers: { min: 2, max: 5, length: 200 },
  reply: 500,
};

// Waar een antwoord naartoe leidt: de volgende vraag, een specifieke latere vraag (id) of direct naar de tips.
export const nextStepSchema = z.union([z.literal("next"), z.literal("end"), z.uuid()]);

// De vorm van een gids zoals de editor (en later de AI) hem oplevert en public.save_guide_content hem opslaat.
// Id's zijn stabiel: een bestaande vraag of antwoord houdt zijn id, nieuwe krijgen er vooraf een.
// Grenzen komen overeen met de checks op de guide-tabellen.
export const guideContentSchema = z
  .object({
    intro: z
      .string()
      .trim()
      .min(1, { error: "Write a short intro." })
      .max(guideLimits.intro, { error: `Keep the intro under ${guideLimits.intro} characters.` }),
    tips: z
      .array(
        z
          .string()
          .trim()
          .min(1, { error: "A tip can't be empty." })
          .max(guideLimits.tips.length, { error: `Keep each tip under ${guideLimits.tips.length} characters.` }),
      )
      .min(guideLimits.tips.min, { error: "Add at least one tip." })
      .max(guideLimits.tips.max, { error: `Use at most ${guideLimits.tips.max} tips.` }),
    questions: z
      .array(
        z.object({
          id: z.uuid(),
          question: z
            .string()
            .trim()
            .min(1, { error: "A question can't be empty." })
            .max(guideLimits.questions.length, {
              error: `Keep each question under ${guideLimits.questions.length} characters.`,
            }),
          answers: z
            .array(
              z.object({
                id: z.uuid(),
                label: z
                  .string()
                  .trim()
                  .min(1, { error: "An answer can't be empty." })
                  .max(guideLimits.answers.length, {
                    error: `Keep each answer under ${guideLimits.answers.length} characters.`,
                  }),
                reply: z
                  .string()
                  .trim()
                  .max(guideLimits.reply, { error: `Keep each reply under ${guideLimits.reply} characters.` })
                  .transform((reply) => reply || null)
                  .nullable(),
                next: nextStepSchema,
              }),
            )
            .min(guideLimits.answers.min, { error: `Give every question at least ${guideLimits.answers.min} answers.` })
            .max(guideLimits.answers.max, { error: `Use at most ${guideLimits.answers.max} answers per question.` }),
        }),
      )
      .max(guideLimits.questions.max, { error: `Use at most ${guideLimits.questions.max} questions.` }),
  })
  .superRefine((content, ctx) => {
    const ids = content.questions.flatMap((question) => [question.id, ...question.answers.map((answer) => answer.id)]);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Every question and answer needs its own id." });
    }

    // Alleen vooruit springen, zodat de flow nooit in een lus raakt.
    content.questions.forEach((question, index) => {
      for (const answer of question.answers) {
        if (answer.next === "next" || answer.next === "end") continue;
        const target = content.questions.findIndex((candidate) => candidate.id === answer.next);
        if (target <= index) {
          ctx.addIssue({
            code: "custom",
            message: `“${answer.label}” can only lead to a later question.`,
            path: ["questions", index, "answers"],
          });
        }
      }
    });
  });

export const guideMomentSchema = z.enum(["ordered", "in_transit", "delivered"]);

