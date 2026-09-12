import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  atomic,
  canonical,
  hash,
  type Identity,
} from "../../core/src/index.js";
import {
  ProtectedGroupStore,
  RegistryIntegrityError,
  type RegistryTransaction,
} from "../../groups/src/storage.js";
import {
  commitProfileBinding,
  decodeProfileBinding,
  prepareProfileBinding,
  type ProfileBinding,
} from "./binding.js";
import {
  PROFILE_STATE_LIMITS,
  readProfileState,
  writeProfileState,
  type ProfileStateBytes,
} from "./state.js";

const INITIALIZATION = "application:initialization";
export interface LegacyProfileState {
  bytes: Buffer;
  sourceDigest: string;
}
interface Initialization {
  domain: "relayloom/profile-initialization/1";
  nonce: string;
  sourceDigest: string;
  initialDigest: string;
}
function insist(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RegistryIntegrityError(message);
}
function readBindingFile(path: string): Buffer {
  const info = lstatSync(path);
  insist(
    info.isFile() && info.size <= 2048,
    "Ficheiro de ligação do perfil inválido",
  );
  const fd = openSync(path, "r");
  try {
    const actual = fstatSync(fd);
    insist(
      actual.isFile() &&
        actual.ino === info.ino &&
        actual.dev === info.dev &&
        actual.size <= 2048,
      "Ligação do perfil mudou durante a abertura",
    );
    const bytes = Buffer.alloc(2049);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    insist(
      length <= 2048 && length === actual.size,
      "Ligação do perfil truncada ou excessiva",
    );
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
function validateLegacy(value: LegacyProfileState): LegacyProfileState {
  insist(
    Buffer.isBuffer(value.bytes) &&
      value.bytes.length > 0 &&
      value.bytes.length <= PROFILE_STATE_LIMITS.bytes &&
      /^[a-f0-9]{64}$/.test(value.sourceDigest),
    "Importação privada inválida",
  );
  insist(
    Buffer.from(canonical(JSON.parse(value.bytes.toString("utf8")))).equals(
      value.bytes,
    ),
    "Importação privada não canónica",
  );
  return value;
}
function checkedInitialization(
  tx: RegistryTransaction,
  binding: ProfileBinding,
): Initialization {
  const bytes = tx.get(INITIALIZATION);
  insist(
    bytes && bytes.length <= 1024,
    "Falta a inicialização protegida do perfil",
  );
  const value = JSON.parse(bytes.toString("utf8"));
  insist(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") ===
        "domain,initialDigest,nonce,sourceDigest" &&
      Buffer.from(canonical(value)).equals(bytes) &&
      value.domain === "relayloom/profile-initialization/1" &&
      value.nonce === binding.body.nonce &&
      value.sourceDigest === binding.body.sourceDigest &&
      typeof value.initialDigest === "string" &&
      /^[a-f0-9]{64}$/.test(value.initialDigest),
    "Inicialização do perfil não corresponde à ligação",
  );
  return value;
}
function initialization(
  tx: RegistryTransaction,
  binding: ProfileBinding,
): Initialization {
  try {
    return checkedInitialization(tx, binding);
  } catch (error) {
    if (error instanceof RegistryIntegrityError) throw error;
    throw new RegistryIntegrityError(
      "Inicialização protegida do perfil ilegível",
    );
  }
}
/** Caller holds the application's process-ownership lease for this directory.
 * Staged initialization can resume; a committed binding never falls back to
 * legacy JSON or silently creates a missing/corrupt protected database. */
export class ProfileDatabase {
  private constructor(
    readonly store: ProtectedGroupStore,
    readonly binding: ProfileBinding,
  ) {}
  static open(
    directory: string,
    identity: Identity,
    loadLegacy: () => LegacyProfileState,
  ): ProfileDatabase {
    const bindingPath = join(directory, "profile-binding.json"),
      databasePath = join(directory, "profile-state.sqlite");
    let binding: ProfileBinding, legacy: LegacyProfileState | undefined;
    if (existsSync(bindingPath))
      binding = decodeProfileBinding(
        readBindingFile(bindingPath),
        identity.public,
      );
    else {
      insist(
        !existsSync(databasePath),
        "Base de dados privada sem ligação assinada; não será reposta",
      );
      legacy = validateLegacy(loadLegacy());
      binding = prepareProfileBinding(
        identity,
        randomBytes(32).toString("hex"),
        legacy.sourceDigest,
      );
      atomic(bindingPath, canonical(binding));
    }
    if (binding.body.phase === "prepared") {
      legacy ??= validateLegacy(loadLegacy());
      insist(
        legacy.sourceDigest === binding.body.sourceDigest,
        "O estado legado mudou durante a preparação; preserve ambas as cópias",
      );
    } else
      insist(
        existsSync(databasePath),
        "Base de dados privada inicializada está ausente; não será reposta",
      );
    const store = new ProtectedGroupStore(
      databasePath,
      identity,
      existsSync(databasePath)
        ? { expectedStoreId: binding.body.storeId }
        : { create: true, newStoreId: binding.body.storeId },
    );
    try {
      if (binding.body.phase === "prepared") {
        store.transaction((tx) => {
          if (tx.keys().length === 0) {
            insist(
              tx.indexBody().revision === 0,
              "Registo vazio com histórico; não será inicializado de novo",
            );
            const initialDigest = writeProfileState(tx, legacy!.bytes, null);
            tx.put(
              INITIALIZATION,
              Buffer.from(
                canonical({
                  domain: "relayloom/profile-initialization/1",
                  nonce: binding.body.nonce,
                  sourceDigest: binding.body.sourceDigest,
                  initialDigest,
                }),
              ),
              "checkpoint",
            );
          }
          const marker = initialization(tx, binding),
            state = readProfileState(tx);
          insist(
            state &&
              state.digest === marker.initialDigest &&
              state.digest === hash(legacy!.bytes),
            "Estado preparado do perfil mudou ou está incompleto",
          );
          const expectedKeys =
            2 + Math.ceil(state.bytes.length / PROFILE_STATE_LIMITS.chunkBytes);
          insist(
            tx.keys().length === expectedKeys,
            "Registos inesperados antes de concluir a inicialização",
          );
        });
        binding = commitProfileBinding(identity, binding);
        atomic(bindingPath, canonical(binding));
      }
      store.view((tx) => {
        initialization(tx, binding);
        insist(
          readProfileState(tx),
          "Estado privado inicializado está ausente",
        );
      });
      return new ProfileDatabase(store, binding);
    } catch (error) {
      store.close();
      throw error;
    }
  }
  read(): ProfileStateBytes {
    return this.store.view((tx) => {
      initialization(tx, this.binding);
      const state = readProfileState(tx);
      insist(state, "Estado privado inicializado está ausente");
      return state;
    });
  }
  transaction<T>(callback: (tx: RegistryTransaction) => T): T {
    return this.store.transaction((tx) => {
      initialization(tx, this.binding);
      const result = callback(tx);
      initialization(tx, this.binding);
      insist(readProfileState(tx), "Estado privado inicializado está ausente");
      return result;
    });
  }
  write(bytes: Buffer, expectedDigest: string): string {
    return this.transaction((tx) =>
      writeProfileState(tx, bytes, expectedDigest),
    );
  }
  close() {
    this.store.close();
  }
}
