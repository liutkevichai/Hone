declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

import type { HoneSettings, ReasoningConfig, GenerationParams } from "../types";
import { DEFAULT_PROFILE_ID, getDefaultProfile, getModelProfile } from "../resources/model-profiles";
import { updateSettings } from "../storage/settings";
import { buildGenerationParameters } from "../generation";
import * as hlog from "../hlog";

export interface ResolvedModel {
  connectionProfileId: string;
  parameters: Record<string, unknown> | undefined;
  reasoning: ReasoningConfig;
}

export async function resolveProfile(
  profileId: string | undefined,
  userId: string,
  onMissingClear?: () => Promise<void>
): Promise<ResolvedModel> {
  let profile;
  if (!profileId || profileId === DEFAULT_PROFILE_ID) {
    profile = getDefaultProfile();
    hlog.debug(userId, `resolveProfile: id="${profileId || ""}" is default/empty -> virtual Default profile`);
  } else {
    const loaded = await getModelProfile(userId, profileId);
    if (loaded) {
      profile = loaded;
    } else {
      profile = getDefaultProfile();
      hlog.debug(
        userId,
        `resolveProfile: id="${profileId}" no longer exists, falling back to Default${onMissingClear ? " and clearing activeModelProfileId" : ""}`
      );
      spindle.log.warn(`[Hone] model profile "${profileId}" no longer exists; falling back to Default`);
      if (onMissingClear) await onMissingClear();
    }
  }

  const parameters = buildGenerationParameters(profile.samplers);
  hlog.debug(
    userId,
    `resolveProfile: id="${profileId || "(default)"}" -> "${profile.name}" connection="${profile.connectionProfileId || "(default)"}" samplers=${JSON.stringify(parameters ?? {})} reasoning=${JSON.stringify(profile.reasoning)}`
  );

  return {
    connectionProfileId: profile.connectionProfileId,
    parameters,
    reasoning: profile.reasoning,
  };
}

export async function resolveModel(settings: HoneSettings, userId: string): Promise<ResolvedModel> {
  return resolveProfile(settings.activeModelProfileId, userId, async () => {
    hlog.debug(userId, `resolveModel: clearing dangling activeModelProfileId -> DEFAULT_PROFILE_ID`);
    await updateSettings(userId, { activeModelProfileId: DEFAULT_PROFILE_ID });
  });
}

/** Map Hone's per-profile reasoning config onto the host's per-request
 *  reasoning override. Lumiverse (1.1.0+) translates the override into
 *  provider-specific parameters; Hone deliberately sends NO provider
 *  reasoning shapes of its own (raw `parameters` win field-level over
 *  host translation, so hand-written `thinking`/`reasoning` params
 *  would suppress the host's correct mapping — that was the source of
 *  the "invalid value for thinking type: adaptive" 400s on
 *  OpenAI-compatible connections).
 *
 *  `inherit` returns undefined rather than `{source:"inherit"}`: the
 *  behavior is identical on 1.1.0+, and omitting the field keeps the
 *  request byte-compatible with what pre-override hosts expect. */
export function buildReasoningOverride(
  reasoning: ReasoningConfig
): import("lumiverse-spindle-types").GenerationReasoningOverrideDTO | undefined {
  switch (reasoning.mode) {
    case "off":
      return { source: "off" };
    case "custom":
      return { source: "custom", apiReasoning: true, effort: reasoning.reasoningEffort };
    default:
      return undefined;
  }
}

export type { GenerationParams };
