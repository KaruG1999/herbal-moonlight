import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CAVDJKLREFHW5NRPLPF6E2YTLFB7U555PB6KD67N6SFTDUS2DKZFT4J5",
  }
} as const

export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"AlreadyInitialized"},
  3: {message:"InvalidPhase"},
  4: {message:"NotYourTurn"},
  5: {message:"InvalidMove"},
  6: {message:"CellAlreadyRevealed"},
  7: {message:"ProofVerificationFailed"},
  8: {message:"CommitmentMismatch"},
  9: {message:"SessionNotFound"},
  10: {message:"InvalidCoordinates"},
  11: {message:"GameAlreadyFinished"},
  12: {message:"SelfPlayNotAllowed"}
}

export type DataKey = {tag: "Admin", values: void} | {tag: "GameHubAddress", values: void} | {tag: "VerifierId", values: void} | {tag: "ImageId", values: void} | {tag: "Session", values: readonly [u32]};

export enum GamePhase {
  WaitingForCommitment = 0,
  WaitingForProof = 1,
  Playing = 2,
  Finished = 3,
}

export enum MoonPhase {
  FullMoon = 0,
  NewMoon = 1,
  Balanced = 2,
}


export interface GameSession {
  creature: string;
  creature_hp: u32;
  creature_points: i128;
  creature_x: u32;
  creature_y: u32;
  garden_commitment: Buffer;
  gardener: string;
  gardener_points: i128;
  moon_phase: MoonPhase;
  phase: GamePhase;
  revealed_cells: Array<u32>;
  session_id: u32;
  turn_number: u32;
}


export interface CellRevealResult {
  damage_dealt: u32;
  has_plant: boolean;
  plant_type: u32;
  x: u32;
  y: u32;
}

export interface Client {
  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the configured Game Hub address
   * 
   * # Returns
   * * `Address` - The Game Hub contract address
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the Game Hub address (admin only)
   * 
   * # Arguments
   * * `new_hub` - The new GameHub contract address
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Update the contract WASM hash (upgrade contract)
   * 
   * # Arguments
   * * `new_wasm_hash` - The hash of the new WASM binary
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new game between Gardener and Creature
   * 
   * **CRITICAL:** This method requires authorization from THIS contract.
   * The Game Hub will call `game_id.require_auth()` which checks this contract's address.
   * 
   * # Arguments
   * * `session_id` - Unique session identifier
   * * `gardener` - Address of the Gardener player
   * * `creature` - Address of the Creature player
   * * `gardener_points` - Points amount committed by Gardener
   * * `creature_points` - Points amount committed by Creature
   */
  start_game: ({session_id, gardener, creature, gardener_points, creature_points}: {session_id: u32, gardener: string, creature: string, gardener_points: i128, creature_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_session transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the current session state
   * 
   * # Arguments
   * * `session_id` - The session ID of the game
   * 
   * # Returns
   * * `GameSession` - The complete game state
   */
  get_session: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<GameSession>>>

  /**
   * Construct and simulate a reveal_cell transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Gardener reveals a cell using ZK proof
   * If Creature dies or reaches the house, the game ends
   * 
   * # Arguments
   * * `session_id` - The session ID of the game
   * * `journal_bytes` - The ZK proof journal bytes
   * * `journal_hash` - SHA256 hash of the journal
   * * `seal` - The Groth16 proof seal (empty for dev mode)
   * 
   * # Dev Mode
   * If the seal is empty, the contract operates in dev mode:
   * - Only verifies that sha256(journal_bytes) == journal_hash
   * - Does NOT provide cryptographic security
   * - Use only for development and testing
   */
  reveal_cell: ({session_id, journal_bytes, journal_hash, seal}: {session_id: u32, journal_bytes: Buffer, journal_hash: Buffer, seal: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<CellRevealResult>>>

  /**
   * Construct and simulate a commit_garden transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Gardener submits the garden commitment hash
   * After this, the game begins and Creature can move
   * 
   * # Arguments
   * * `session_id` - The session ID of the game
   * * `garden_commitment` - SHA256 hash of the garden layout (32 bytes)
   */
  commit_garden: ({session_id, garden_commitment}: {session_id: u32, garden_commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a creature_move transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Creature moves to a new position
   * After moving, state transitions to WaitingForProof
   * 
   * # Arguments
   * * `session_id` - The session ID of the game
   * * `new_x` - New X coordinate (0-4)
   * * `new_y` - New Y coordinate (0-4)
   */
  creature_move: ({session_id, new_x, new_y}: {session_id: u32, new_x: u32, new_y: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub, verifier_id, image_id}: {admin: string, game_hub: string, verifier_id: string, image_id: Buffer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub, verifier_id, image_id}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAADAAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMSW52YWxpZFBoYXNlAAAAAwAAAAAAAAALTm90WW91clR1cm4AAAAABAAAAAAAAAALSW52YWxpZE1vdmUAAAAABQAAAAAAAAATQ2VsbEFscmVhZHlSZXZlYWxlZAAAAAAGAAAAAAAAABdQcm9vZlZlcmlmaWNhdGlvbkZhaWxlZAAAAAAHAAAAAAAAABJDb21taXRtZW50TWlzbWF0Y2gAAAAAAAgAAAAAAAAAD1Nlc3Npb25Ob3RGb3VuZAAAAAAJAAAAAAAAABJJbnZhbGlkQ29vcmRpbmF0ZXMAAAAAAAoAAAAAAAAAE0dhbWVBbHJlYWR5RmluaXNoZWQAAAAACwAAAAAAAAASU2VsZlBsYXlOb3RBbGxvd2VkAAAAAAAM",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAOR2FtZUh1YkFkZHJlc3MAAAAAAAAAAAAAAAAAClZlcmlmaWVySWQAAAAAAAAAAAAAAAAAB0ltYWdlSWQAAAAAAQAAAAAAAAAHU2Vzc2lvbgAAAAABAAAABA==",
        "AAAAAwAAAAAAAAAAAAAACUdhbWVQaGFzZQAAAAAAAAQAAAAAAAAAFFdhaXRpbmdGb3JDb21taXRtZW50AAAAAAAAAAAAAAAPV2FpdGluZ0ZvclByb29mAAAAAAEAAAAAAAAAB1BsYXlpbmcAAAAAAgAAAAAAAAAIRmluaXNoZWQAAAAD",
        "AAAAAwAAAAAAAAAAAAAACU1vb25QaGFzZQAAAAAAAAMAAAAAAAAACEZ1bGxNb29uAAAAAAAAAAAAAAAHTmV3TW9vbgAAAAABAAAAAAAAAAhCYWxhbmNlZAAAAAI=",
        "AAAAAQAAAAAAAAAAAAAAC0dhbWVTZXNzaW9uAAAAAA0AAAAAAAAACGNyZWF0dXJlAAAAEwAAAAAAAAALY3JlYXR1cmVfaHAAAAAABAAAAAAAAAAPY3JlYXR1cmVfcG9pbnRzAAAAAAsAAAAAAAAACmNyZWF0dXJlX3gAAAAAAAQAAAAAAAAACmNyZWF0dXJlX3kAAAAAAAQAAAAAAAAAEWdhcmRlbl9jb21taXRtZW50AAAAAAAD7gAAACAAAAAAAAAACGdhcmRlbmVyAAAAEwAAAAAAAAAPZ2FyZGVuZXJfcG9pbnRzAAAAAAsAAAAAAAAACm1vb25fcGhhc2UAAAAAB9AAAAAJTW9vblBoYXNlAAAAAAAAAAAAAAVwaGFzZQAAAAAAB9AAAAAJR2FtZVBoYXNlAAAAAAAAAAAAAA5yZXZlYWxlZF9jZWxscwAAAAAD6gAAAAQAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAAC3R1cm5fbnVtYmVyAAAAAAQ=",
        "AAAAAAAAAFpHZXQgdGhlIGNvbmZpZ3VyZWQgR2FtZSBIdWIgYWRkcmVzcwoKIyBSZXR1cm5zCiogYEFkZHJlc3NgIC0gVGhlIEdhbWUgSHViIGNvbnRyYWN0IGFkZHJlc3MAAAAAAAdnZXRfaHViAAAAAAAAAAABAAAD6QAAABMAAAAD",
        "AAAAAAAAAGRVcGRhdGUgdGhlIEdhbWUgSHViIGFkZHJlc3MgKGFkbWluIG9ubHkpCgojIEFyZ3VtZW50cwoqIGBuZXdfaHViYCAtIFRoZSBuZXcgR2FtZUh1YiBjb250cmFjdCBhZGRyZXNzAAAAB3NldF9odWIAAAAAAQAAAAAAAAAHbmV3X2h1YgAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAHFVcGRhdGUgdGhlIGNvbnRyYWN0IFdBU00gaGFzaCAodXBncmFkZSBjb250cmFjdCkKCiMgQXJndW1lbnRzCiogYG5ld193YXNtX2hhc2hgIC0gVGhlIGhhc2ggb2YgdGhlIG5ldyBXQVNNIGJpbmFyeQAAAAAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAQAAAAAAAAAAAAAAEENlbGxSZXZlYWxSZXN1bHQAAAAFAAAAAAAAAAxkYW1hZ2VfZGVhbHQAAAAEAAAAAAAAAAloYXNfcGxhbnQAAAAAAAABAAAAAAAAAApwbGFudF90eXBlAAAAAAAEAAAAAAAAAAF4AAAAAAAABAAAAAAAAAABeQAAAAAAAAQ=",
        "AAAAAAAAAdJTdGFydCBhIG5ldyBnYW1lIGJldHdlZW4gR2FyZGVuZXIgYW5kIENyZWF0dXJlCgoqKkNSSVRJQ0FMOioqIFRoaXMgbWV0aG9kIHJlcXVpcmVzIGF1dGhvcml6YXRpb24gZnJvbSBUSElTIGNvbnRyYWN0LgpUaGUgR2FtZSBIdWIgd2lsbCBjYWxsIGBnYW1lX2lkLnJlcXVpcmVfYXV0aCgpYCB3aGljaCBjaGVja3MgdGhpcyBjb250cmFjdCdzIGFkZHJlc3MuCgojIEFyZ3VtZW50cwoqIGBzZXNzaW9uX2lkYCAtIFVuaXF1ZSBzZXNzaW9uIGlkZW50aWZpZXIKKiBgZ2FyZGVuZXJgIC0gQWRkcmVzcyBvZiB0aGUgR2FyZGVuZXIgcGxheWVyCiogYGNyZWF0dXJlYCAtIEFkZHJlc3Mgb2YgdGhlIENyZWF0dXJlIHBsYXllcgoqIGBnYXJkZW5lcl9wb2ludHNgIC0gUG9pbnRzIGFtb3VudCBjb21taXR0ZWQgYnkgR2FyZGVuZXIKKiBgY3JlYXR1cmVfcG9pbnRzYCAtIFBvaW50cyBhbW91bnQgY29tbWl0dGVkIGJ5IENyZWF0dXJlAAAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAIZ2FyZGVuZXIAAAATAAAAAAAAAAhjcmVhdHVyZQAAABMAAAAAAAAAD2dhcmRlbmVyX3BvaW50cwAAAAALAAAAAAAAAA9jcmVhdHVyZV9wb2ludHMAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAItHZXQgdGhlIGN1cnJlbnQgc2Vzc2lvbiBzdGF0ZQoKIyBBcmd1bWVudHMKKiBgc2Vzc2lvbl9pZGAgLSBUaGUgc2Vzc2lvbiBJRCBvZiB0aGUgZ2FtZQoKIyBSZXR1cm5zCiogYEdhbWVTZXNzaW9uYCAtIFRoZSBjb21wbGV0ZSBnYW1lIHN0YXRlAAAAAAtnZXRfc2Vzc2lvbgAAAAABAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAQAAA+kAAAfQAAAAC0dhbWVTZXNzaW9uAAAAAAM=",
        "AAAAAAAAAflHYXJkZW5lciByZXZlYWxzIGEgY2VsbCB1c2luZyBaSyBwcm9vZgpJZiBDcmVhdHVyZSBkaWVzIG9yIHJlYWNoZXMgdGhlIGhvdXNlLCB0aGUgZ2FtZSBlbmRzCgojIEFyZ3VtZW50cwoqIGBzZXNzaW9uX2lkYCAtIFRoZSBzZXNzaW9uIElEIG9mIHRoZSBnYW1lCiogYGpvdXJuYWxfYnl0ZXNgIC0gVGhlIFpLIHByb29mIGpvdXJuYWwgYnl0ZXMKKiBgam91cm5hbF9oYXNoYCAtIFNIQTI1NiBoYXNoIG9mIHRoZSBqb3VybmFsCiogYHNlYWxgIC0gVGhlIEdyb3RoMTYgcHJvb2Ygc2VhbCAoZW1wdHkgZm9yIGRldiBtb2RlKQoKIyBEZXYgTW9kZQpJZiB0aGUgc2VhbCBpcyBlbXB0eSwgdGhlIGNvbnRyYWN0IG9wZXJhdGVzIGluIGRldiBtb2RlOgotIE9ubHkgdmVyaWZpZXMgdGhhdCBzaGEyNTYoam91cm5hbF9ieXRlcykgPT0gam91cm5hbF9oYXNoCi0gRG9lcyBOT1QgcHJvdmlkZSBjcnlwdG9ncmFwaGljIHNlY3VyaXR5Ci0gVXNlIG9ubHkgZm9yIGRldmVsb3BtZW50IGFuZCB0ZXN0aW5nAAAAAAAAC3JldmVhbF9jZWxsAAAAAAQAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAADWpvdXJuYWxfYnl0ZXMAAAAAAAAOAAAAAAAAAAxqb3VybmFsX2hhc2gAAAPuAAAAIAAAAAAAAAAEc2VhbAAAAA4AAAABAAAD6QAAB9AAAAAQQ2VsbFJldmVhbFJlc3VsdAAAAAM=",
        "AAAAAAAAASdJbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIEdhbWVIdWIgYWRkcmVzcywgYWRtaW4sIGFuZCBaSyB2ZXJpZmllcgoKIyBBcmd1bWVudHMKKiBgYWRtaW5gIC0gQWRtaW4gYWRkcmVzcyAoY2FuIHVwZ3JhZGUgY29udHJhY3QpCiogYGdhbWVfaHViYCAtIEFkZHJlc3Mgb2YgdGhlIEdhbWVIdWIgY29udHJhY3QKKiBgdmVyaWZpZXJfaWRgIC0gQWRkcmVzcyBvZiB0aGUgR3JvdGgxNiB2ZXJpZmllciBjb250cmFjdAoqIGBpbWFnZV9pZGAgLSBJbWFnZSBJRCBvZiB0aGUgUmlzY1plcm8gY2lyY3VpdCAoMzIgYnl0ZXMpAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhnYW1lX2h1YgAAABMAAAAAAAAAC3ZlcmlmaWVyX2lkAAAAABMAAAAAAAAACGltYWdlX2lkAAAD7gAAACAAAAAA",
        "AAAAAAAAANpHYXJkZW5lciBzdWJtaXRzIHRoZSBnYXJkZW4gY29tbWl0bWVudCBoYXNoCkFmdGVyIHRoaXMsIHRoZSBnYW1lIGJlZ2lucyBhbmQgQ3JlYXR1cmUgY2FuIG1vdmUKCiMgQXJndW1lbnRzCiogYHNlc3Npb25faWRgIC0gVGhlIHNlc3Npb24gSUQgb2YgdGhlIGdhbWUKKiBgZ2FyZGVuX2NvbW1pdG1lbnRgIC0gU0hBMjU2IGhhc2ggb2YgdGhlIGdhcmRlbiBsYXlvdXQgKDMyIGJ5dGVzKQAAAAAADWNvbW1pdF9nYXJkZW4AAAAAAAACAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAABFnYXJkZW5fY29tbWl0bWVudAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAANJDcmVhdHVyZSBtb3ZlcyB0byBhIG5ldyBwb3NpdGlvbgpBZnRlciBtb3ZpbmcsIHN0YXRlIHRyYW5zaXRpb25zIHRvIFdhaXRpbmdGb3JQcm9vZgoKIyBBcmd1bWVudHMKKiBgc2Vzc2lvbl9pZGAgLSBUaGUgc2Vzc2lvbiBJRCBvZiB0aGUgZ2FtZQoqIGBuZXdfeGAgLSBOZXcgWCBjb29yZGluYXRlICgwLTQpCiogYG5ld195YCAtIE5ldyBZIGNvb3JkaW5hdGUgKDAtNCkAAAAAAA1jcmVhdHVyZV9tb3ZlAAAAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAFbmV3X3gAAAAAAAAEAAAAAAAAAAVuZXdfeQAAAAAAAAQAAAABAAAD6QAAAAIAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_hub: this.txFromJSON<Result<string>>,
        set_hub: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<null>,
        start_game: this.txFromJSON<Result<void>>,
        get_session: this.txFromJSON<Result<GameSession>>,
        reveal_cell: this.txFromJSON<Result<CellRevealResult>>,
        commit_garden: this.txFromJSON<Result<void>>,
        creature_move: this.txFromJSON<Result<void>>
  }
}