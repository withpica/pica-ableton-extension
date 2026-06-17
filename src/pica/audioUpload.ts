// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { type PicaMcpClient } from "./mcpClient";
import { createReadStream } from "node:fs";

export const MAX_UPLOAD_BYTES = 800 * 1024 * 1024; // presigned-upload contract

export function exceedsCap(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac",
  aiff: "audio/aiff", aif: "audio/aiff", ogg: "audio/ogg", webm: "audio/webm",
};

export function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return CONTENT_TYPES[ext] ?? "audio/wav";
}

export function presignedArgs(input: { filename: string; fileSize: number; workId?: string }): Record<string, unknown> {
  return {
    filename: input.filename,
    content_type: contentTypeFor(input.filename),
    file_size: input.fileSize,
    file_type: "stem",
    ...(input.workId ? { work_id: input.workId } : {}),
  };
}

export function completeArgs(input: {
  uploadId: string; key: string; bucket: string; filename: string; fileSize: number; recordingId: string; stemLabel: string;
}): Record<string, unknown> {
  return {
    upload_id: input.uploadId,
    key: input.key,
    bucket: input.bucket,
    content_type: contentTypeFor(input.filename),
    file_size: input.fileSize,
    recording_id: input.recordingId,
    file_type: "stem",
    stem_label: input.stemLabel,
  };
}

interface UploadDeps {
  client: PicaMcpClient;
  fetchFn: typeof fetch;
  openStream: (path: string) => ReturnType<typeof createReadStream>;
}

/** presign → PUT (streamed) → complete (linked to the recording) → analyze (best-effort). */
export async function uploadRenderedStem(
  deps: UploadDeps,
  input: { wavPath: string; fileName: string; fileSize: number; recordingId: string; workId?: string; stemLabel: string },
): Promise<{ fileId?: string }> {
  const presign = (await deps.client.callTool(
    "pica_audio_presigned_upload",
    presignedArgs({ filename: input.fileName, fileSize: input.fileSize, workId: input.workId }),
  )) as { upload_url: string; upload_id: string; key: string; bucket: string };

  const res = await deps.fetchFn(presign.upload_url, {
    method: "PUT",
    body: deps.openStream(input.wavPath) as unknown as BodyInit,
    // @ts-expect-error Node fetch requires duplex for a stream body
    duplex: "half",
    headers: { "content-type": contentTypeFor(input.fileName) },
  });
  if (!res.ok) throw new Error(`upload PUT failed: ${res.status}`);

  const done = (await deps.client.callTool(
    "pica_audio_complete_upload",
    completeArgs({
      uploadId: presign.upload_id, key: presign.key, bucket: presign.bucket,
      filename: input.fileName, fileSize: input.fileSize, recordingId: input.recordingId, stemLabel: input.stemLabel,
    }),
  )) as { id?: string; file_id?: string };

  const fileId = done?.id ?? done?.file_id;
  if (fileId) {
    await deps.client.callTool("pica_audio_analyze", { file_id: fileId }).catch(() => undefined);
  }
  return { fileId };
}
