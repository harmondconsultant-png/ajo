// Wallet context tests.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletProvider, useWallet } from "./wallet-context";
import { connectWallet, signWithWallet, WalletError } from "@/lib/wallet";

vi.mock("@/lib/wallet", () => {
  class WalletError extends Error {}
  return { WalletError, connectWallet: vi.fn(), signWithWallet: vi.fn() };
});

const mockConnect = vi.mocked(connectWallet);
const mockSign = vi.mocked(signWithWallet);

const STORAGE_KEY = "ajo_wallet_address";
const ALICE = "GALICE";
const BOB = "GBOB";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let store: Map<string, string>;

function installMockLocalStorage() {
  store = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => void store.clear(),
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Wallet = ReturnType<typeof useWallet>;

let container: HTMLDivElement;
let root: Root;

/** Mount a WalletProvider and return a getter for the latest hook value. */
async function renderWallet(): Promise<() => Wallet> {
  let latest: Wallet | undefined;
  function Probe() {
    latest = useWallet();
    return null;
  }
  await act(async () => {
    root.render(createElement(WalletProvider, null, createElement(Probe)));
  });
  return () => latest!;
}

beforeEach(() => {
  installMockLocalStorage();
  mockConnect.mockReset();
  mockSign.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useWallet", () => {
  it("throws when used outside a WalletProvider", () => {
    function Orphan() {
      useWallet();
      return null;
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => act(() => root.render(createElement(Orphan)))).toThrow(/within a WalletProvider/);
    spy.mockRestore();
  });

  describe("restore on mount", () => {
    it("settles as disconnected without prompting when nothing is stored", async () => {
      const wallet = await renderWallet();
      expect(mockConnect).not.toHaveBeenCalled();
      expect(wallet().address).toBeNull();
      expect(wallet().restoring).toBe(false);
      expect(wallet().connecting).toBe(false);
    });

    it("stays restoring until the silent reconnect settles", async () => {
      store.set(STORAGE_KEY, ALICE);
      const pending = deferred<string>();
      mockConnect.mockReturnValue(pending.promise);

      const wallet = await renderWallet();
      expect(wallet().restoring).toBe(true);
      expect(wallet().address).toBeNull();

      await act(async () => pending.resolve(ALICE));
      expect(wallet().restoring).toBe(false);
      expect(wallet().address).toBe(ALICE);
    });

    it("uses the account the extension confirms, not the cached one", async () => {
      store.set(STORAGE_KEY, ALICE);
      mockConnect.mockResolvedValue(BOB);

      const wallet = await renderWallet();
      expect(wallet().address).toBe(BOB);
    });

    it("clears the cached address when the silent reconnect fails", async () => {
      store.set(STORAGE_KEY, ALICE);
      mockConnect.mockRejectedValue(new WalletError("gone"));

      const wallet = await renderWallet();
      expect(wallet().address).toBeNull();
      expect(wallet().restoring).toBe(false);
      expect(store.has(STORAGE_KEY)).toBe(false);
    });

    it("tolerates blocked storage", async () => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError");
        },
      });

      const wallet = await renderWallet();
      expect(mockConnect).not.toHaveBeenCalled();
      expect(wallet().restoring).toBe(false);
      expect(wallet().address).toBeNull();
    });
  });

  describe("connectWallet", () => {
    it("flags connecting while pending, then stores the address", async () => {
      const wallet = await renderWallet();
      const pending = deferred<string>();
      mockConnect.mockReturnValue(pending.promise);

      let result: Promise<string> | undefined;
      act(() => {
        result = wallet().connectWallet();
      });
      expect(wallet().connecting).toBe(true);

      await act(async () => pending.resolve(ALICE));
      await expect(result).resolves.toBe(ALICE);
      expect(wallet().connecting).toBe(false);
      expect(wallet().address).toBe(ALICE);
      expect(store.get(STORAGE_KEY)).toBe(ALICE);
    });

    it("rejects and resets connecting on failure, leaving state untouched", async () => {
      const wallet = await renderWallet();
      mockConnect.mockRejectedValue(new WalletError("No Stellar wallet found."));

      await act(async () => {
        await expect(wallet().connectWallet()).rejects.toThrow("No Stellar wallet found.");
      });
      expect(wallet().connecting).toBe(false);
      expect(wallet().address).toBeNull();
      expect(store.has(STORAGE_KEY)).toBe(false);
    });

    it("switches to the new account when reconnecting after an account change", async () => {
      const wallet = await renderWallet();
      mockConnect.mockResolvedValueOnce(ALICE).mockResolvedValueOnce(BOB);

      await act(async () => void (await wallet().connectWallet()));
      expect(wallet().address).toBe(ALICE);

      await act(async () => void (await wallet().connectWallet()));
      expect(wallet().address).toBe(BOB);
      expect(store.get(STORAGE_KEY)).toBe(BOB);
    });
  });

  describe("disconnectWallet", () => {
    it("clears the address and the cached value", async () => {
      store.set(STORAGE_KEY, ALICE);
      mockConnect.mockResolvedValue(ALICE);
      const wallet = await renderWallet();
      expect(wallet().address).toBe(ALICE);

      act(() => wallet().disconnectWallet());
      expect(wallet().address).toBeNull();
      expect(store.has(STORAGE_KEY)).toBe(false);
    });
  });

  describe("signTransaction", () => {
    it("refuses to sign without a connected wallet", async () => {
      const wallet = await renderWallet();
      await expect(wallet().signTransaction("XDR")).rejects.toBeInstanceOf(WalletError);
      expect(mockSign).not.toHaveBeenCalled();
    });

    it("signs with the connected address", async () => {
      const wallet = await renderWallet();
      mockConnect.mockResolvedValue(ALICE);
      mockSign.mockResolvedValue("SIGNED");
      await act(async () => void (await wallet().connectWallet()));

      await expect(wallet().signTransaction("XDR")).resolves.toBe("SIGNED");
      expect(mockSign).toHaveBeenCalledWith("XDR", ALICE);
    });

    it("signs with the new address after an account change", async () => {
      const wallet = await renderWallet();
      mockConnect.mockResolvedValueOnce(ALICE).mockResolvedValueOnce(BOB);
      mockSign.mockResolvedValue("SIGNED");
      await act(async () => void (await wallet().connectWallet()));
      await act(async () => void (await wallet().connectWallet()));

      await wallet().signTransaction("XDR");
      expect(mockSign).toHaveBeenCalledWith("XDR", BOB);
    });
  });
});
