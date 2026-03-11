import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";

export async function getMintInfoRobust(connection: Connection, mintKey: PublicKey) {
    const maxAttempts = 5;
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const mintAccount = await connection.getAccountInfo(mintKey, "confirmed");
            if (!mintAccount) {
                throw new Error("mint account not found");
            }

            const owner = mintAccount.owner;
            if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
                throw new Error(`unexpected mint owner program: ${owner.toBase58()}`);
            }

            return await getMint(connection, mintKey, "confirmed", owner);
        } catch (e) {
            lastErr = e;
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 300));
            }
        }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function checkTokenSecurity(connection: Connection, mintAddress: string): Promise<boolean> {
    try {
        const mintKey = new PublicKey(mintAddress);
        const mintInfo = await getMintInfoRobust(connection, mintKey);

        if (CONFIG.REQUIRE_RENOUNCED_MINT && mintInfo.mintAuthority !== null) {
            console.log(`   ⚠️ Mint Authority NOT renounced! Owner: ${mintInfo.mintAuthority.toBase58()}`);
            return false;
        }

        if (CONFIG.REQUIRE_NO_FREEZE && mintInfo.freezeAuthority !== null) {
            console.log(`   ⚠️ Freeze Authority ENABLED! Owner: ${mintInfo.freezeAuthority.toBase58()}`);
            return false;
        }

        console.log("   🛡️ Mint/Freeze Security: PASSED");
        return true;
    } catch (e: any) {
        const reason = e?.message || String(e);
        console.log(`   ⚠️ Could not verify token security: ${reason}`);
        return false;
    }
}
