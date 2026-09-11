export const SOCIAL_LIMITS = Object.freeze({
  collections: 32,
  collectionItems: 256,
  totalCollectionItems: 2048,
  titleLength: 64,
  following: 256,
});

export interface Collection {
  id: string;
  ownerId: string;
  title: string;
  objectIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type CollectionCommand =
  | { action: "create"; id: string; title: string }
  | { action: "rename"; id: string; title: string }
  | { action: "delete"; id: string }
  | { action: "add" | "remove"; id: string; objectId: string };

function plainRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Metadados sociais inválidos");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(fields, key) || !("value" in fields[key]))
  )
    throw new Error("Campos sociais inválidos");
  return value as Record<string, unknown>;
}

function plainArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new Error("Lista social inválida");
  if (value.length > maximum) throw new Error("Limite de referências sociais");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Array.from({ length: value.length }, (_, i) => fields[String(i)]).some(
      (field) => !field || !("value" in field),
    )
  )
    throw new Error("Lista social inválida");
  return value;
}

function address(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Endereço social inválido");
  return value;
}

/** An address is a reference, never a read key or proof of ownership. */
export function requireContentId(value: unknown): string {
  return address(value);
}

function collectionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new Error("Identificador de colecção inválido");
  return value;
}

function title(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/.test(value))
    throw new Error("Nome de colecção inválido");
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > SOCIAL_LIMITS.titleLength)
    throw new Error("Use um nome de colecção com 1 a 64 caracteres");
  return normalized;
}

function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Data social inválida");
  return value;
}

function addresses(value: unknown, maximum: number): string[] {
  const values = plainArray(value, maximum);
  const ids = Array.from(values, address);
  if (new Set(ids).size !== ids.length)
    throw new Error("Referências sociais repetidas");
  return ids;
}

/** Validate recovered local metadata before exposing it or applying a command. */
export function validateCollections(
  value: unknown,
  ownerId: string,
): Collection[] {
  const owner = address(ownerId),
    input = plainArray(value, SOCIAL_LIMITS.collections);
  const ids = new Set<string>(),
    titles = new Set<string>();
  let total = 0;
  return Array.from(input, (item) => {
    const row = plainRecord(item, [
      "id",
      "ownerId",
      "title",
      "objectIds",
      "createdAt",
      "updatedAt",
    ]);
    const id = collectionId(row.id),
      name = title(row.title),
      createdAt = timestamp(row.createdAt),
      updatedAt = timestamp(row.updatedAt);
    if (address(row.ownerId) !== owner)
      throw new Error("A colecção pertence a outra identidade");
    if (ids.has(id) || titles.has(name.toLowerCase()))
      throw new Error("Colecção repetida");
    if (updatedAt < createdAt) throw new Error("Datas da colecção inválidas");
    const objectIds = addresses(row.objectIds, SOCIAL_LIMITS.collectionItems);
    total += objectIds.length;
    if (total > SOCIAL_LIMITS.totalCollectionItems)
      throw new Error("Limite total de referências em colecções");
    ids.add(id);
    titles.add(name.toLowerCase());
    return { id, ownerId: owner, title: name, objectIds, createdAt, updatedAt };
  });
}

function validateCommand(value: unknown): CollectionCommand {
  if (
    !value ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error("Acção de colecção inválida");
  const action = Object.getOwnPropertyDescriptor(value, "action");
  if (!action || !("value" in action))
    throw new Error("Acção de colecção inválida");
  if (action.value === "create" || action.value === "rename") {
    const command = plainRecord(value, ["action", "id", "title"]);
    return {
      action: action.value,
      id: collectionId(command.id),
      title: title(command.title),
    };
  }
  if (action.value === "delete") {
    const command = plainRecord(value, ["action", "id"]);
    return { action: "delete", id: collectionId(command.id) };
  }
  if (action.value === "add" || action.value === "remove") {
    const command = plainRecord(value, ["action", "id", "objectId"]);
    return {
      action: action.value,
      id: collectionId(command.id),
      objectId: address(command.objectId),
    };
  }
  throw new Error("Acção de colecção desconhecida");
}

/** Pure local metadata transition. The caller supplies authenticated owner/time/UUID. */
export function applyCollectionCommand(
  collections: readonly Collection[],
  ownerId: string,
  command: CollectionCommand,
  now: number,
): Collection[] {
  const next = validateCollections(collections, ownerId),
    operation = validateCommand(command),
    at = timestamp(now);
  if (operation.action === "create") {
    if (next.length >= SOCIAL_LIMITS.collections)
      throw new Error("Limite de colecções");
    if (
      next.some(
        (c) =>
          c.id === operation.id ||
          c.title.toLowerCase() === operation.title.toLowerCase(),
      )
    )
      throw new Error("Já existe uma colecção com esse nome ou identificador");
    return [
      ...next,
      {
        id: operation.id,
        ownerId,
        title: operation.title,
        objectIds: [],
        createdAt: at,
        updatedAt: at,
      },
    ];
  }
  const index = next.findIndex((c) => c.id === operation.id);
  if (index < 0) throw new Error("Colecção indisponível nesta identidade");
  const current = next[index];
  if (operation.action === "delete")
    return next.filter((c) => c.id !== current.id);
  if (operation.action === "rename") {
    if (
      next.some(
        (c) =>
          c.id !== current.id &&
          c.title.toLowerCase() === operation.title.toLowerCase(),
      )
    )
      throw new Error("Já existe uma colecção com esse nome");
    if (current.title === operation.title) return next;
    current.title = operation.title;
  } else if (operation.action === "add") {
    if (current.objectIds.includes(operation.objectId)) return next;
    if (current.objectIds.length >= SOCIAL_LIMITS.collectionItems)
      throw new Error("Limite de itens nesta colecção");
    if (
      next.reduce((sum, c) => sum + c.objectIds.length, 0) >=
      SOCIAL_LIMITS.totalCollectionItems
    )
      throw new Error("Limite total de referências em colecções");
    current.objectIds.push(operation.objectId);
  } else {
    if (!current.objectIds.includes(operation.objectId)) return next;
    current.objectIds = current.objectIds.filter(
      (id) => id !== operation.objectId,
    );
  }
  current.updatedAt = Math.max(at, current.updatedAt);
  return next;
}

export function validateFollowing(value: unknown): string[] {
  return addresses(value, SOCIAL_LIMITS.following);
}

export interface FeedItem {
  kind: string;
  author: { id: string };
}

/** Input must already be decrypted/authorized by LoomNode; following grants no access. */
export function followedFeed<T extends FeedItem>(
  objects: readonly T[],
  following: readonly string[],
): T[] {
  const authors = new Set(validateFollowing(following));
  return objects.filter(
    (object) =>
      (object.kind === "post" || object.kind === "alert") &&
      authors.has(object.author.id),
  );
}
