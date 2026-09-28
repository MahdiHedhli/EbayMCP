import type { DraftStore, ListingDraft } from "../domain/drafts.js";

export class InMemoryDraftStore implements DraftStore {
  readonly #drafts = new Map<string, ListingDraft>();

  async create(draft: ListingDraft): Promise<ListingDraft> {
    this.#drafts.set(draft.id, structuredClone(draft));
    return structuredClone(draft);
  }

  async get(id: string): Promise<ListingDraft | undefined> {
    const draft = this.#drafts.get(id);
    return draft ? structuredClone(draft) : undefined;
  }
}
