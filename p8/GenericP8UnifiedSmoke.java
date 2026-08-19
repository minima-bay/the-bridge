import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;

import org.minima.database.mmr.MMRData;
import org.minima.database.mmr.MMRProof;
import org.minima.kissvm.Contract;
import org.minima.objects.Address;
import org.minima.objects.Coin;
import org.minima.objects.CoinProof;
import org.minima.objects.ScriptProof;
import org.minima.objects.StateVariable;
import org.minima.objects.Token;
import org.minima.objects.Transaction;
import org.minima.objects.TxPoW;
import org.minima.objects.Witness;
import org.minima.objects.base.MiniData;
import org.minima.objects.base.MiniNumber;
import org.minima.objects.base.MiniString;
import org.minima.objects.keys.Signature;
import org.minima.objects.keys.TreeKey;
import org.minima.system.brains.TxPoWGenerator;
import org.minima.system.params.GlobalParams;
import org.minima.utils.Crypto;
import org.minima.utils.Streamable;

public final class GenericP8UnifiedSmoke {
    private static final BigInteger EXECUTION_BLOCK = new BigInteger("22123500");
    private static final BigInteger EXECUTION_TIME = new BigInteger("1700000000000");

    private static String repeatHex(String pair, int bytes) {
        StringBuilder output = new StringBuilder("0x");
        for (int index = 0; index < bytes; index++) output.append(pair);
        return output.toString();
    }
    private static String seedHex(int operator) {
        StringBuilder output = new StringBuilder("0x");
        for (int index = 0; index < 32; index++) output.append(String.format("%02x", (operator * 41 + index) & 255));
        return output.toString();
    }
    private static MiniNumber rawAmount(BigInteger atoms) { return new MiniNumber(atoms.toString()).mult(MiniNumber.MINI_UNIT); }
    private static MiniData hashText(String value) { return new MiniData(Crypto.getInstance().hashData(value.getBytes(StandardCharsets.US_ASCII))); }
    private static int serializedBytes(Streamable value) throws Exception { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); DataOutputStream output = new DataOutputStream(bytes); value.writeDataStream(output); output.flush(); return bytes.size(); }
    private static Transaction copyTransaction(Transaction value) throws Exception { ByteArrayOutputStream bytes = new ByteArrayOutputStream(); DataOutputStream output = new DataOutputStream(bytes); value.writeDataStream(output); output.flush(); Transaction copy = new Transaction(); copy.readDataStream(new DataInputStream(new ByteArrayInputStream(bytes.toByteArray()))); return copy; }
    private static String subset(int start, int width) { return "SUBSET(" + start + " " + (start + width) + " record)"; }
    private static String number(int start, int width) { return "NUMBER(" + subset(start, width) + ")"; }
    private static String ascii32(String value) {
        byte[] output = new byte[32];
        byte[] source = value.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(source, 0, output, 0, source.length);
        return new MiniData(output).to0xString();
    }
    private static BigInteger readUInt(byte[] data, int offset, int width) {
        byte[] output = new byte[width]; System.arraycopy(data, offset, output, 0, width);
        return new BigInteger(1, output);
    }
    private static void writeHex(byte[] output, int offset, int width, MiniData value) {
        if (value.getLength() != width) throw new IllegalArgumentException("wrong fixed field width");
        System.arraycopy(value.getBytes(), 0, output, offset, width);
    }
    private static void writeUInt(byte[] output, int offset, int width, BigInteger value) {
        byte[] raw = value.toByteArray(); int source = raw.length > width ? raw.length - width : 0; int length = Math.min(raw.length, width);
        for (int index = 0; index < width; index++) output[offset + index] = 0;
        System.arraycopy(raw, source, output, offset + width - length, length);
    }
    private static String multisig(String[] publicKeys) {
        StringBuilder output = new StringBuilder("MULTISIG(5");
        for (String publicKey : publicKeys) output.append(" ").append(publicKey);
        return output.append(")").toString();
    }

    private static String makeScript(String bridgeId, String controlId, String[] committeePublicKeys, BigInteger tokenFactor) {
        String quorum = multisig(committeePublicKeys);
        StringBuilder script = new StringBuilder();
        script.append("LET record=STATE(90) LET action=").append(number(34, 2)).append(" ");
        script.append("ASSERT GETINADDR(0) EQ @ADDRESS ASSERT GETINADDR(1) EQ @ADDRESS ");
        script.append("ASSERT GETINTOK(0) EQ ").append(controlId).append(" ASSERT GETINAMT(0) EQ 1 ");
        script.append("ASSERT GETINTOK(1) EQ ").append(bridgeId).append(" ");
        script.append("ASSERT GETOUTADDR(0) EQ @ADDRESS ASSERT GETOUTTOK(0) EQ ").append(controlId).append(" ");
        script.append("ASSERT GETOUTAMT(0) EQ 1 ASSERT GETOUTKEEPSTATE(0) EQ TRUE ");
        script.append("ASSERT GETOUTADDR(1) EQ @ADDRESS ASSERT GETOUTTOK(1) EQ ").append(bridgeId).append(" ASSERT GETOUTKEEPSTATE(1) EQ FALSE ");

        script.append("IF action EQ 1 THEN ASSERT LEN(record) EQ 501 ASSERT ").append(subset(0, 32)).append(" EQ ").append(ascii32("BRIDGE_LANE_CLIENT_V2")).append(" ");
        script.append("ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 2 ASSERT GETOUTAMT(1) EQ GETINAMT(1) ");
        script.append("ELSEIF action EQ 2 THEN ASSERT LEN(record) EQ 581 ASSERT ").append(subset(0, 32)).append(" EQ ").append(ascii32("BRIDGE_LANE_RELEASE_V2")).append(" ");
        script.append("ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 3 LET amountdest=").append(number(357, 8)).append(" ");
        script.append("ASSERT amountdest GT 0 ASSERT GETOUTADDR(2) EQ ").append(subset(365, 32)).append(" ASSERT GETOUTTOK(2) EQ ").append(bridgeId).append(" ");
        script.append("ASSERT GETOUTKEEPSTATE(2) EQ FALSE ASSERT (GETOUTAMT(2)*").append(tokenFactor).append(") EQ amountdest ");
        script.append("ASSERT (GETINAMT(1)*").append(tokenFactor).append(") EQ ((GETOUTAMT(1)*").append(tokenFactor).append(")+amountdest) ");
        script.append("ELSEIF action EQ 3 THEN ASSERT LEN(record) EQ 417 ASSERT ").append(subset(0, 32)).append(" EQ ").append(ascii32("BRIDGE_LANE_RETURN_V2")).append(" ");
        script.append("ASSERT @TOTIN EQ 3 ASSERT @TOTOUT EQ 2 LET amountdest=").append(number(357, 8)).append(" ");
        script.append("ASSERT GETINTOK(2) EQ ").append(bridgeId).append(" ASSERT GETINID(2) EQ ").append(subset(317, 32)).append(" ");
        script.append("ASSERT (GETINAMT(2)*").append(tokenFactor).append(") EQ amountdest ");
        script.append("ASSERT GETOUTAMT(1) EQ (GETINAMT(1)+GETINAMT(2)) ");
        script.append("ELSEIF action EQ 5 THEN ASSERT LEN(record) EQ 634 ASSERT ").append(subset(0, 32)).append(" EQ ").append(ascii32("BRIDGE_LANE_CANCEL_V2")).append(" ");
        script.append("ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 2 ASSERT GETOUTAMT(1) EQ GETINAMT(1) ");
        script.append("ELSEIF action EQ 7 THEN ASSERT LEN(record) EQ 661 ASSERT ").append(subset(0, 32)).append(" EQ ").append(ascii32("BRIDGE_LANE_PAYOUT_V2")).append(" ");
        script.append("ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 2 ASSERT GETOUTAMT(1) EQ GETINAMT(1) ");
        script.append("ELSE RETURN FALSE ENDIF ");
        script.append("IF @INPUT EQ 1 THEN RETURN TRUE ENDIF ASSERT @INPUT EQ 0 ");

        script.append("ASSERT ").append(number(32, 2)).append(" EQ 1 ASSERT ").append(number(36, 2)).append(" EQ 2 ");
        script.append("ASSERT ").append(number(38, 1)).append(" EQ PREVSTATE(30) ASSERT ").append(number(39, 1)).append(" EQ PREVSTATE(31) ");
        script.append("ASSERT ").append(number(40, 1)).append(" EQ PREVSTATE(32) ASSERT ").append(number(41, 8)).append(" EQ PREVSTATE(38) ");
        script.append("ASSERT ").append(number(49, 8)).append(" EQ PREVSTATE(39) ASSERT ").append(number(57, 8)).append(" EQ PREVSTATE(33) ");
        script.append("ASSERT ").append(number(65, 8)).append(" EQ PREVSTATE(35) ASSERT ").append(subset(73, 32)).append(" EQ PREVSTATE(36) ");
        script.append("ASSERT ").append(subset(105, 20)).append(" EQ PREVSTATE(12) ASSERT ").append(subset(125, 20)).append(" EQ PREVSTATE(34) ");
        script.append("ASSERT ").append(subset(145, 32)).append(" EQ PREVSTATE(11) ASSERT ").append(subset(177, 32)).append(" EQ PREVSTATE(13) ");
        script.append("ASSERT ").append(subset(209, 32)).append(" EQ @ADDRESS ASSERT ").append(subset(241, 32)).append(" EQ PREVSTATE(14) ");
        script.append("ASSERT ").append(number(273, 8)).append(" EQ PREVSTATE(1) ASSERT ").append(number(281, 4)).append(" EQ PREVSTATE(28) ");
        script.append("ASSERT ").append(subset(285, 32)).append(" EQ PREVSTATE(29) ASSERT PREVSTATE(6) EQ (GETINAMT(1)*").append(tokenFactor).append(") ");

        script.append("IF action EQ 3 THEN ");
        script.append("LET amountsource=").append(number(349, 8)).append(" LET amountdest=").append(number(357, 8)).append(" ");
        script.append("ASSERT amountsource GT 0 ASSERT (amountsource*PREVSTATE(39)) EQ (amountdest*PREVSTATE(38)) ");
        script.append("ASSERT PREVSTATE(4) GTE amountdest ASSERT STATE(4) EQ (PREVSTATE(4)-amountdest) ASSERT STATE(5) EQ (PREVSTATE(5)+amountdest) ");
        script.append("ASSERT STATE(6) EQ (PREVSTATE(6)+amountdest) ASSERT STATE(19) EQ ").append(subset(385, 32)).append(" ");
        script.append("ASSERT STATE(20) EQ ").append(subset(365, 20)).append(" ASSERT STATE(21) EQ ").append(subset(317, 32)).append(" ASSERT STATE(22) EQ amountdest ");
        script.append("ASSERT SAMESTATE(0 3) ASSERT SAMESTATE(7 18) ASSERT SAMESTATE(23 39) RETURN TRUE ENDIF ");

        script.append("ASSERT ").append(quorum).append(" ");
        script.append("IF action EQ 1 THEN ");
        script.append(headChecks(317, 325, 333, 341, 405, 437, 469, 477, 485, 493));
        script.append("ASSERT ((STATE(4)+STATE(5))*PREVSTATE(38)) LTE (STATE(8)*PREVSTATE(39)) ASSERT (STATE(4)+STATE(5)) LTE PREVSTATE(33) ");
        script.append("ASSERT STATE(4) EQ PREVSTATE(4) ASSERT STATE(5) EQ PREVSTATE(5) ASSERT STATE(6) EQ PREVSTATE(6) ASSERT SAMESTATE(0 1) ASSERT SAMESTATE(4 7) ASSERT SAMESTATE(9 14) ASSERT SAMESTATE(18 24) ASSERT SAMESTATE(28 39) RETURN TRUE ");
        script.append("ELSEIF action EQ 2 THEN ");
        script.append("LET amountsource=").append(number(349, 8)).append(" LET amountdest=").append(number(357, 8)).append(" ASSERT amountsource GT 0 ");
        script.append("ASSERT (amountsource*PREVSTATE(39)) EQ (amountdest*PREVSTATE(38)) ASSERT amountdest LT PREVSTATE(6) ");
        script.append("ASSERT STATE(4) EQ (PREVSTATE(4)+amountdest) ASSERT STATE(5) EQ PREVSTATE(5) ASSERT STATE(6) EQ (PREVSTATE(6)-amountdest) ");
        script.append(headChecks(469, 477, 397, 405, 485, 517, 549, 557, 565, 573));
        script.append("ASSERT STATE(10) EQ SHA3(CONCAT(PREVSTATE(10) PREVSTATE(11) ").append(subset(317, 32)).append(" ").append(subset(34, 2)).append(")) ");
        script.append("ASSERT ((STATE(4)+STATE(5))*PREVSTATE(38)) LTE (STATE(8)*PREVSTATE(39)) ASSERT (STATE(4)+STATE(5)) LTE PREVSTATE(33) ");
        script.append("ASSERT SAMESTATE(0 1) ASSERT SAMESTATE(7 7) ASSERT SAMESTATE(9 9) ASSERT SAMESTATE(11 16) ASSERT SAMESTATE(18 24) ASSERT SAMESTATE(28 39) RETURN TRUE ");
        script.append("ELSEIF action EQ 5 THEN ");
        script.append("ASSERT ").append(number(449, 1)).append(" EQ 1 ASSERT SIGNEDBY(").append(subset(417, 32)).append(") ");
        script.append(headChecks(522, 530, 450, 458, 538, 570, 602, 610, 618, 626));
        script.append("ASSERT STATE(10) EQ SHA3(CONCAT(PREVSTATE(10) PREVSTATE(11) ").append(subset(317, 32)).append(" ").append(subset(34, 2)).append(")) ");
        script.append("ASSERT ((PREVSTATE(4)+PREVSTATE(5))*PREVSTATE(38)) LTE (STATE(8)*PREVSTATE(39)) ASSERT (PREVSTATE(4)+PREVSTATE(5)) LTE PREVSTATE(33) ");
        script.append("ASSERT SAMESTATE(0 1) ASSERT SAMESTATE(4 7) ASSERT SAMESTATE(9 9) ASSERT SAMESTATE(11 16) ASSERT SAMESTATE(18 24) ASSERT SAMESTATE(28 39) RETURN TRUE ");
        script.append("ELSEIF action EQ 7 THEN ");
        script.append("LET batchsource=").append(number(381, 8)).append(" LET batchdest=").append(number(389, 8)).append(" ASSERT batchsource GT 0 ");
        script.append("ASSERT (batchsource*PREVSTATE(39)) EQ (batchdest*PREVSTATE(38)) ASSERT ").append(number(349, 8)).append(" EQ PREVSTATE(15) ");
        script.append("ASSERT ").append(number(357, 8)).append(" EQ (PREVSTATE(15)+1) ASSERT ").append(number(365, 8)).append(" EQ PREVSTATE(16) ");
        script.append("ASSERT ").append(number(373, 8)).append(" EQ (PREVSTATE(16)+batchsource) ASSERT PREVSTATE(5) GTE batchdest ");
        script.append("ASSERT STATE(4) EQ PREVSTATE(4) ASSERT STATE(5) EQ (PREVSTATE(5)-batchdest) ASSERT STATE(6) EQ PREVSTATE(6) ");
        script.append(headChecks(565, 573, 493, 501, 581, 613, 645, -1, -1, 653));
        script.append("ASSERT STATE(15) EQ ").append(number(357, 8)).append(" ASSERT STATE(16) EQ ").append(number(373, 8)).append(" ");
        script.append("ASSERT ((STATE(4)+STATE(5))*PREVSTATE(38)) LTE (STATE(8)*PREVSTATE(39)) ASSERT (STATE(4)+STATE(5)) LTE PREVSTATE(33) ");
        script.append("ASSERT SAMESTATE(0 1) ASSERT SAMESTATE(4 4) ASSERT SAMESTATE(6 7) ASSERT SAMESTATE(9 14) ASSERT SAMESTATE(18 24) ASSERT SAMESTATE(28 39) RETURN TRUE ENDIF RETURN FALSE");
        return Contract.cleanScript(script.toString());
    }

    private static String headChecks(int priorVersion, int nextVersion, int block, int blockHash, int clientHash,
        int bridgeHash, int vaultBalance, int cursor, int cumulativePaid, int sourceTime) {
        StringBuilder script = new StringBuilder();
        script.append("ASSERT ").append(number(priorVersion, 8)).append(" EQ PREVSTATE(25) ASSERT ").append(number(nextVersion, 8)).append(" EQ (PREVSTATE(25)+1) ");
        script.append("ASSERT ").append(number(block, 8)).append(" GTE PREVSTATE(26) ASSERT STATE(25) EQ ").append(number(nextVersion, 8)).append(" ");
        script.append("ASSERT STATE(26) EQ ").append(number(block, 8)).append(" ASSERT STATE(27) EQ ").append(subset(blockHash, 32)).append(" ");
        script.append("ASSERT STATE(2) EQ ").append(subset(clientHash, 32)).append(" ASSERT STATE(3) EQ ").append(subset(bridgeHash, 32)).append(" ");
        script.append("ASSERT STATE(8) EQ ").append(number(vaultBalance, 8)).append(" ASSERT STATE(17) GTE PREVSTATE(17) ASSERT STATE(17) LTE @BLOCK ");
        script.append("ASSERT (@BLOCK-STATE(17)) LTE PREVSTATE(18) ");
        if (cursor >= 0) script.append("ASSERT STATE(15) EQ ").append(number(cursor, 8)).append(" ");
        if (cumulativePaid >= 0) script.append("ASSERT STATE(16) EQ ").append(number(cumulativePaid, 8)).append(" ");
        script.append("LET sourcetime=").append(number(sourceTime, 8)).append(" ASSERT sourcetime LTE (@BLOCKMILLI+PREVSTATE(24)) ASSERT @BLOCKMILLI LTE (sourcetime+PREVSTATE(23)) ");
        return script.toString();
    }

    private static ArrayList<StateVariable> previousState(byte[] record, Token bridge, Token control, MiniData covenant, BigInteger issued, BigInteger pending, BigInteger reserve) {
        ArrayList<StateVariable> state = new ArrayList<>();
        state.add(new StateVariable(0, "2")); state.add(new StateVariable(1, readUInt(record, 273, 8).toString()));
        state.add(new StateVariable(2, hashText("p8-prior-client").to0xString())); state.add(new StateVariable(3, hashText("p8-prior-bridge").to0xString()));
        state.add(new StateVariable(4, issued.toString())); state.add(new StateVariable(5, pending.toString())); state.add(new StateVariable(6, reserve.toString()));
        state.add(new StateVariable(7, issued.add(reserve).toString())); state.add(new StateVariable(8, readUInt(record, 38, 1).equals(BigInteger.ZERO) ? "4000000000000000000" : "4000000"));
        state.add(new StateVariable(9, readUInt(record, 40, 1).toString())); state.add(new StateVariable(10, hashText("p8-nullifier-root").to0xString()));
        state.add(new StateVariable(11, new MiniData(slice(record, 145, 32)).to0xString())); state.add(new StateVariable(12, new MiniData(slice(record, 105, 20)).to0xString()));
        state.add(new StateVariable(13, bridge.getTokenID().to0xString())); state.add(new StateVariable(14, control.getTokenID().to0xString()));
        long action = readUInt(record, 34, 2).longValue();
        state.add(new StateVariable(15, action == 7 ? readUInt(record, 349, 8).toString() : "3"));
        state.add(new StateVariable(16, action == 7 ? readUInt(record, 365, 8).toString() : (readUInt(record, 38, 1).equals(BigInteger.ZERO) ? "200000000000000000" : "200000")));
        state.add(new StateVariable(17, EXECUTION_BLOCK.subtract(BigInteger.TEN).toString())); state.add(new StateVariable(18, "100"));
        state.add(new StateVariable(19, hashText("p8-prior-redemption").to0xString())); state.add(new StateVariable(20, repeatHex("aa", 20)));
        state.add(new StateVariable(21, hashText("p8-prior-returned-coin").to0xString())); state.add(new StateVariable(22, "1"));
        state.add(new StateVariable(23, "3600000")); state.add(new StateVariable(24, "300000"));
        int priorVersion = action == 1 ? 317 : action == 2 ? 469 : action == 5 ? 522 : action == 7 ? 565 : -1;
        int blockOffset = action == 1 ? 333 : action == 2 ? 397 : action == 5 ? 450 : action == 7 ? 493 : -1;
        state.add(new StateVariable(25, priorVersion < 0 ? "17" : readUInt(record, priorVersion, 8).toString()));
        state.add(new StateVariable(26, blockOffset < 0 ? "22123456" : readUInt(record, blockOffset, 8).subtract(BigInteger.ONE).toString()));
        state.add(new StateVariable(27, hashText("p8-prior-finalized-hash").to0xString()));
        state.add(new StateVariable(28, readUInt(record, 281, 4).toString())); state.add(new StateVariable(29, new MiniData(slice(record, 285, 32)).to0xString()));
        state.add(new StateVariable(30, readUInt(record, 38, 1).toString())); state.add(new StateVariable(31, readUInt(record, 39, 1).toString()));
        state.add(new StateVariable(32, readUInt(record, 40, 1).toString())); state.add(new StateVariable(33, readUInt(record, 57, 8).toString()));
        state.add(new StateVariable(34, new MiniData(slice(record, 125, 20)).to0xString())); state.add(new StateVariable(35, readUInt(record, 65, 8).toString()));
        state.add(new StateVariable(36, new MiniData(slice(record, 73, 32)).to0xString())); state.add(new StateVariable(37, covenant.to0xString()));
        state.add(new StateVariable(38, readUInt(record, 41, 8).toString())); state.add(new StateVariable(39, readUInt(record, 49, 8).toString()));
        return state;
    }

    private static byte[] slice(byte[] source, int offset, int length) { byte[] output = new byte[length]; System.arraycopy(source, offset, output, 0, length); return output; }
    private static void addSuccessorState(Transaction tx, ArrayList<StateVariable> prior, byte[] record, long action, BigInteger issued, BigInteger pending, BigInteger reserve) {
        for (StateVariable item : prior) tx.addStateVariable(new StateVariable(item.getPort(), item.toString()));
        if (action == 1 || action == 2 || action == 5 || action == 7) {
            int nextVersion = action == 1 ? 325 : action == 2 ? 477 : action == 5 ? 530 : 573;
            int block = action == 1 ? 333 : action == 2 ? 397 : action == 5 ? 450 : 493;
            int blockHash = action == 1 ? 341 : action == 2 ? 405 : action == 5 ? 458 : 501;
            int client = action == 1 ? 405 : action == 2 ? 485 : action == 5 ? 538 : 581;
            int bridgeHash = action == 1 ? 437 : action == 2 ? 517 : action == 5 ? 570 : 613;
            int vault = action == 1 ? 469 : action == 2 ? 549 : action == 5 ? 602 : 645;
            tx.addStateVariable(new StateVariable(2, new MiniData(slice(record, client, 32)).to0xString()));
            tx.addStateVariable(new StateVariable(3, new MiniData(slice(record, bridgeHash, 32)).to0xString()));
            tx.addStateVariable(new StateVariable(8, readUInt(record, vault, 8).toString()));
            tx.addStateVariable(new StateVariable(17, EXECUTION_BLOCK.subtract(BigInteger.ONE).toString()));
            tx.addStateVariable(new StateVariable(25, readUInt(record, nextVersion, 8).toString()));
            tx.addStateVariable(new StateVariable(26, readUInt(record, block, 8).toString()));
            tx.addStateVariable(new StateVariable(27, new MiniData(slice(record, blockHash, 32)).to0xString()));
        }
        if (action == 2) {
            BigInteger amount = readUInt(record, 357, 8); issued = issued.add(amount); reserve = reserve.subtract(amount);
            MiniData root = new MiniData(Crypto.getInstance().hashData(concat(new MiniData(prior.get(10).toString()).getBytes(), slice(record, 145, 32), slice(record, 317, 32), slice(record, 34, 2))));
            tx.addStateVariable(new StateVariable(10, root.to0xString()));
        } else if (action == 3) {
            BigInteger amount = readUInt(record, 357, 8); issued = issued.subtract(amount); pending = pending.add(amount); reserve = reserve.add(amount);
            tx.addStateVariable(new StateVariable(19, new MiniData(slice(record, 385, 32)).to0xString())); tx.addStateVariable(new StateVariable(20, new MiniData(slice(record, 365, 20)).to0xString()));
            tx.addStateVariable(new StateVariable(21, new MiniData(slice(record, 317, 32)).to0xString())); tx.addStateVariable(new StateVariable(22, amount.toString()));
        } else if (action == 5) {
            MiniData root = new MiniData(Crypto.getInstance().hashData(concat(new MiniData(prior.get(10).toString()).getBytes(), slice(record, 145, 32), slice(record, 317, 32), slice(record, 34, 2))));
            tx.addStateVariable(new StateVariable(10, root.to0xString()));
        } else if (action == 7) {
            pending = pending.subtract(readUInt(record, 389, 8));
            tx.addStateVariable(new StateVariable(15, readUInt(record, 357, 8).toString())); tx.addStateVariable(new StateVariable(16, readUInt(record, 373, 8).toString()));
        }
        tx.addStateVariable(new StateVariable(4, issued.toString())); tx.addStateVariable(new StateVariable(5, pending.toString())); tx.addStateVariable(new StateVariable(6, reserve.toString()));
        tx.addStateVariable(new StateVariable(90, new MiniData(record).to0xString()));
    }
    private static byte[] concat(byte[]... parts) { int length = 0; for (byte[] part : parts) length += part.length; byte[] output = new byte[length]; int offset = 0; for (byte[] part : parts) { System.arraycopy(part, 0, output, offset, part.length); offset += part.length; } return output; }
    private static MMRProof[] syntheticProofs(Coin[] coins, int depth) {
        if (coins.length != 2 && coins.length != 3) throw new IllegalArgumentException("two or three coins required");
        MMRData[] leaves = new MMRData[coins.length == 2 ? 2 : 4];
        for (int index = 0; index < coins.length; index++) leaves[index] = MMRData.CreateMMRDataLeafNode(coins[index], coins[index].getAmount());
        if (coins.length == 3) {
            Coin dummy = new Coin(hashText("p8-mmr-dummy"), Address.TRUE_ADDRESS.getAddressData(), MiniNumber.ZERO, MiniData.ZERO_TXPOWID, false);
            leaves[3] = MMRData.CreateMMRDataLeafNode(dummy, MiniNumber.ZERO);
        }
        MMRProof[] proofs = new MMRProof[coins.length]; for (int index = 0; index < coins.length; index++) proofs[index] = new MMRProof(new MiniNumber("22123400"));
        proofs[0].addProofChunk(false, leaves[1]); proofs[1].addProofChunk(true, leaves[0]);
        int startLevel;
        if (coins.length == 3) {
            MMRData leftParent = MMRData.CreateMMRDataParentNode(leaves[0], leaves[1]);
            MMRData rightParent = MMRData.CreateMMRDataParentNode(leaves[2], leaves[3]);
            proofs[0].addProofChunk(false, rightParent); proofs[1].addProofChunk(false, rightParent);
            proofs[2].addProofChunk(false, leaves[3]); proofs[2].addProofChunk(true, leftParent); startLevel = 2;
        } else startLevel = 1;
        for (int level = startLevel; level < depth; level++) {
            MMRData sibling = new MMRData(hashText("p8-mmr-sibling-" + level), MiniNumber.ZERO);
            for (MMRProof proof : proofs) proof.addProofChunk(false, sibling);
        }
        MMRData expected = null;
        for (int index = 0; index < coins.length; index++) {
            MMRData root = proofs[index].calculateProof(leaves[index]);
            if (expected == null) expected = root; else if (!expected.isEqual(root)) throw new IllegalStateException("proof roots differ");
        }
        return proofs;
    }
    private static void bindRedemptionId(byte[] record) throws Exception {
        byte[] domain = new byte[32]; byte[] label = "BRIDGE_LANE_REDEMPTION_V2".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(label, 0, domain, 0, label.length);
        byte[] preimage = concat(domain, slice(record, 73, 32), slice(record, 145, 32), slice(record, 177, 32),
            slice(record, 209, 32), slice(record, 317, 32), slice(record, 357, 8), slice(record, 365, 20), slice(record, 273, 8));
        writeHex(record, 385, 32, new MiniData(MessageDigest.getInstance("SHA-256").digest(preimage)));
    }
    private static Contract run(String script, Witness witness, Transaction tx, int input, ArrayList<StateVariable> state) {
        Contract contract = new Contract(script, witness.getAllSignatureKeys(), witness, tx, state);
        contract.setGlobals(EXECUTION_BLOCK.toString().equals("") ? MiniNumber.ZERO : new MiniNumber(EXECUTION_BLOCK.toString()), new MiniNumber(EXECUTION_TIME.toString()), tx, input, EXECUTION_BLOCK.subtract(BigInteger.valueOf(100)).equals(BigInteger.ZERO) ? MiniNumber.ZERO : new MiniNumber(EXECUTION_BLOCK.subtract(BigInteger.valueOf(100)).toString()), script);
        contract.run(); return contract;
    }
    private static Witness witnessFor(Transaction tx, long action, TreeKey[] committee, TreeKey authority, Witness baseline, int committeeCount, boolean includeAuthority) throws Exception {
        Witness witness = new Witness();
        if (action != 3) for (int index = 0; index < committeeCount; index++) witness.addSignature(committee[index].sign(tx.getTransactionID()));
        if (includeAuthority) witness.addSignature(authority.sign(tx.getTransactionID()));
        for (CoinProof proof : baseline.getAllCoinProofs()) witness.addCoinProof(proof);
        for (ScriptProof proof : baseline.getAllScripts()) witness.addScript(proof);
        return witness;
    }
    private static boolean mutationRejected(String kind, Transaction baselineTx, Witness baselineWitness, String script,
        ArrayList<StateVariable> previous, long action, TreeKey[] committee, TreeKey authority, Token bridge) throws Exception {
        if (kind.equals("missingQuorum")) {
            Witness changedWitness = witnessFor(baselineTx, action, committee, authority, baselineWitness, 4, action == 5);
            Contract changed = run(script, changedWitness, baselineTx, 0, previous);
            return !changed.isSuccess() || changed.isException();
        }
        if (kind.equals("missingAuthority")) {
            Witness changedWitness = witnessFor(baselineTx, action, committee, authority, baselineWitness, 5, false);
            Contract changed = run(script, changedWitness, baselineTx, 0, previous);
            return !changed.isSuccess() || changed.isException();
        }
        if (kind.equals("missingReturnOwner")) {
            Witness changedWitness = witnessFor(baselineTx, action, committee, authority, baselineWitness, 0, false);
            Contract owner = run("RETURN SIGNEDBY(" + authority.getPublicKey().to0xString() + ")", changedWitness, baselineTx, 2, new ArrayList<StateVariable>());
            return !owner.isSuccess() || owner.isException();
        }
        Transaction tx = copyTransaction(baselineTx);
        if (kind.equals("extraOutput")) {
            Coin extra = new Coin(Address.TRUE_ADDRESS.getAddressData(), rawAmount(BigInteger.ONE), bridge.getTokenID(), false); extra.setToken(bridge); tx.addOutput(extra);
        } else if (kind.equals("releasePayout")) {
            Coin original = tx.getAllOutputs().get(2);
            Coin changed = new Coin(original.getAddress(), original.getAmount().add(MiniNumber.MINI_UNIT), bridge.getTokenID(), false); changed.setToken(bridge); tx.getAllOutputs().set(2, changed);
        } else if (kind.equals("accounting")) {
            tx.addStateVariable(new StateVariable(4, "999999999"));
        } else {
            byte[] changedRecord = new MiniData(tx.getStateValue(90).toString()).getBytes().clone();
            if (kind.equals("lane")) changedRecord[145] ^= 1;
            else if (kind.equals("action")) { changedRecord[34] = 0; changedRecord[35] = 9; }
            else if (kind.equals("returnCoin")) changedRecord[317] ^= 1;
            else if (kind.equals("cancelStatus")) changedRecord[449] = 2;
            else if (kind.equals("payoutCursor")) { BigInteger next = readUInt(changedRecord, 357, 8).add(BigInteger.ONE); writeUInt(changedRecord, 357, 8, next); tx.addStateVariable(new StateVariable(15, next.toString())); }
            else if (kind.equals("clientVersion")) { BigInteger next = readUInt(changedRecord, 325, 8).add(BigInteger.ONE); writeUInt(changedRecord, 325, 8, next); tx.addStateVariable(new StateVariable(25, next.toString())); }
            else if (kind.equals("undercollateralizedVault")) {
                if (action != 3) {
                    int vault = action == 1 ? 469 : action == 2 ? 549 : action == 5 ? 602 : 645;
                    writeUInt(changedRecord, vault, 8, BigInteger.ZERO);
                }
                tx.addStateVariable(new StateVariable(8, "0"));
            }
            tx.addStateVariable(new StateVariable(90, new MiniData(changedRecord).to0xString()));
        }
        TxPoWGenerator.precomputeTransactionCoinID(tx); tx.calculateTransactionID();
        Witness changedWitness = witnessFor(tx, action, committee, authority, baselineWitness, action == 3 ? 0 : 5, action == 3 || action == 5);
        Contract changed = run(script, changedWitness, tx, 0, previous);
        return !changed.isSuccess() || changed.isException();
    }
    private static String failureLine(Contract contract) {
        String result = "";
        for (String line : contract.getCompleteTraceLog().split("\\n")) {
            if (line.contains("ASSERT") || line.contains("failed") || line.contains("FAIL")) result = line;
        }
        return escape(result);
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 11 && args[0].equals("render")) {
            String mode = args[1]; String bridgeId = args[2]; String controlId = args[3];
            String[] publicKeys = new String[7]; System.arraycopy(args, 4, publicKeys, 0, 7);
            BigInteger tokenFactor = BigInteger.TEN.pow(mode.equals("eth") ? 18 : 6);
            String rendered = makeScript(bridgeId, controlId, publicKeys, tokenFactor);
            MiniData renderedAddress = new Address(rendered).getAddressData();
            System.out.println("{\"script\":\"" + escape(rendered) + "\",\"address\":\"" + renderedAddress.to0xString().toLowerCase() + "\",\"scriptBytes\":" + rendered.getBytes(StandardCharsets.UTF_8).length + "}");
            return;
        }
        if (args.length != 3) throw new IllegalArgumentException("mode action recordHex required");
        String mode = args[0]; String actionName = args[1]; byte[] record = new MiniData(args[2]).getBytes().clone();
        long action = readUInt(record, 34, 2).longValue();
        TreeKey[] committee = new TreeKey[7]; for (int index = 0; index < 7; index++) committee[index] = TreeKey.createDefault(new MiniData(seedHex(index + 1)));
        TreeKey authority = TreeKey.createDefault(new MiniData(seedHex(20)));
        BigInteger fixed = mode.equals("eth") ? new BigInteger("11000000000000000000") : new BigInteger("1000001000000");
        BigInteger issued = mode.equals("eth") ? new BigInteger("1000000000000000000") : new BigInteger("1000000");
        BigInteger pending = action == 7 ? (mode.equals("eth") ? new BigInteger("400000000000000000") : new BigInteger("400000")) : (mode.equals("eth") ? new BigInteger("200000000000000000") : new BigInteger("200000"));
        BigInteger reserve = fixed.subtract(issued);
        Token bridge = new Token(hashText("p8-" + mode + "-token-coin"), new MiniNumber(mode.equals("eth") ? "26" : "38"), rawAmount(fixed), new MiniString("P8 bridge"), new MiniString("RETURN TRUE"));
        Token control = new Token(hashText("p8-" + mode + "-control-coin"), new MiniNumber("44"), rawAmount(BigInteger.ONE), new MiniString("P8 control"), new MiniString("RETURN TRUE"));
        BigInteger tokenFactor = BigInteger.TEN.pow(mode.equals("eth") ? 18 : 6);
        String[] committeePublicKeys = new String[7]; for (int index = 0; index < 7; index++) committeePublicKeys[index] = committee[index].getPublicKey().to0xString();
        String script = makeScript(bridge.getTokenID().to0xString(), control.getTokenID().to0xString(), committeePublicKeys, tokenFactor); MiniData address = new Address(script).getAddressData();
        ByteArrayOutputStreamLike roots = new ByteArrayOutputStreamLike(); for (TreeKey key : committee) roots.write(key.getPublicKey().getBytes());
        MiniData committeeRoot = new MiniData(Crypto.getInstance().hashData(roots.bytes()));
        writeHex(record, 177, 32, bridge.getTokenID()); writeHex(record, 209, 32, address); writeHex(record, 241, 32, control.getTokenID()); writeHex(record, 285, 32, committeeRoot);
        if (action == 5) writeHex(record, 417, 32, authority.getPublicKey());
        if (action == 3) bindRedemptionId(record);
        ArrayList<StateVariable> previous = previousState(record, bridge, control, address, issued, pending, reserve);
        Coin controlInput = new Coin(hashText(mode + actionName + "-control"), address, rawAmount(BigInteger.ONE), control.getTokenID(), true); controlInput.setToken(control); controlInput.setState(previous);
        Coin reserveInput = new Coin(hashText(mode + actionName + "-reserve"), address, rawAmount(reserve), bridge.getTokenID(), false); reserveInput.setToken(bridge);
        Transaction tx = new Transaction(); tx.addInput(controlInput); tx.addInput(reserveInput);
        TreeKey returnOwner = authority; Coin returnedInput = null; String returnScript = "RETURN SIGNEDBY(" + returnOwner.getPublicKey().to0xString() + ")";
        BigInteger nextReserve = reserve;
        if (action == 3) { BigInteger amount = readUInt(record, 357, 8); returnedInput = new Coin(new MiniData(slice(record, 317, 32)), new Address(returnScript).getAddressData(), rawAmount(amount), bridge.getTokenID(), false); returnedInput.setToken(bridge); tx.addInput(returnedInput); nextReserve = reserve.add(amount); }
        if (action == 2) nextReserve = reserve.subtract(readUInt(record, 357, 8));
        Coin controlOutput = new Coin(address, rawAmount(BigInteger.ONE), control.getTokenID(), true); controlOutput.setToken(control); tx.addOutput(controlOutput);
        Coin reserveOutput = new Coin(address, rawAmount(nextReserve), bridge.getTokenID(), false); reserveOutput.setToken(bridge); tx.addOutput(reserveOutput);
        if (action == 2) { Coin payout = new Coin(new MiniData(slice(record, 365, 32)), rawAmount(readUInt(record, 357, 8)), bridge.getTokenID(), false); payout.setToken(bridge); tx.addOutput(payout); }
        addSuccessorState(tx, previous, record, action, issued, pending, reserve); TxPoWGenerator.precomputeTransactionCoinID(tx); tx.calculateTransactionID();
        Witness witness = new Witness();
        if (action != 3) for (int index = 0; index < 5; index++) witness.addSignature(committee[index].sign(tx.getTransactionID()));
        if (action == 3 || action == 5) witness.addSignature(authority.sign(tx.getTransactionID()));
        Coin[] proofCoins = action == 3 ? new Coin[] { controlInput, reserveInput, returnedInput } : new Coin[] { controlInput, reserveInput };
        MMRProof[] proofs = syntheticProofs(proofCoins, 32);
        for (int index = 0; index < proofCoins.length; index++) witness.addCoinProof(new CoinProof(proofCoins[index], proofs[index]));
        witness.addScript(new ScriptProof(script)); if (action == 3) witness.addScript(new ScriptProof(returnScript));
        Contract controlContract = run(script, witness, tx, 0, previous); Contract reserveContract = run(script, witness, tx, 1, new ArrayList<StateVariable>());
        boolean ownerPassed = true; int ownerInstructions = 0; String ownerFailure = ""; if (action == 3) { Contract owner = run(returnScript, witness, tx, 2, new ArrayList<StateVariable>()); ownerPassed = owner.isSuccess() && !owner.isException(); ownerInstructions = owner.getNumberOfInstructions(); ownerFailure = failureLine(owner); }
        boolean laneRejected = mutationRejected("lane", tx, witness, script, previous, action, committee, authority, bridge);
        boolean actionRejected = mutationRejected("action", tx, witness, script, previous, action, committee, authority, bridge);
        boolean extraOutputRejected = mutationRejected("extraOutput", tx, witness, script, previous, action, committee, authority, bridge);
        boolean accountingRejected = mutationRejected("accounting", tx, witness, script, previous, action, committee, authority, bridge);
        boolean authorizationRejected = action == 3
            ? mutationRejected("missingReturnOwner", tx, witness, script, previous, action, committee, authority, bridge)
            : mutationRejected(action == 5 ? "missingAuthority" : "missingQuorum", tx, witness, script, previous, action, committee, authority, bridge);
        boolean actionSpecificRejected = action == 1 ? mutationRejected("clientVersion", tx, witness, script, previous, action, committee, authority, bridge)
            : action == 2 ? mutationRejected("releasePayout", tx, witness, script, previous, action, committee, authority, bridge)
            : action == 3 ? mutationRejected("returnCoin", tx, witness, script, previous, action, committee, authority, bridge)
            : action == 5 ? mutationRejected("cancelStatus", tx, witness, script, previous, action, committee, authority, bridge)
            : mutationRejected("payoutCursor", tx, witness, script, previous, action, committee, authority, bridge);
        boolean undercollateralizedVaultRejected = mutationRejected("undercollateralizedVault", tx, witness, script, previous, action, committee, authority, bridge);
        Transaction staleTx = copyTransaction(tx); Coin staleExtra = new Coin(Address.TRUE_ADDRESS.getAddressData(), rawAmount(BigInteger.ONE), bridge.getTokenID(), false); staleExtra.setToken(bridge); staleTx.addOutput(staleExtra); TxPoWGenerator.precomputeTransactionCoinID(staleTx); staleTx.calculateTransactionID();
        boolean staleSignatureRejected = action == 3 ? !authority.verify(staleTx.getTransactionID(), witness.getAllSignatures().get(0)) : !committee[0].verify(staleTx.getTransactionID(), witness.getAllSignatures().get(0));
        MMRData syntheticRoot = proofs[0].calculateProof(MMRData.CreateMMRDataLeafNode(controlInput, controlInput.getAmount()));
        TxPoW txpow = new TxPoW(); txpow.setTransaction(tx); txpow.setWitness(witness); txpow.setTxDifficulty(Crypto.MAX_HASH); txpow.setBlockDifficulty(Crypto.MAX_HASH);
        txpow.setNonce(new MiniNumber("256")); txpow.setTimeMilli(new MiniNumber(EXECUTION_TIME.toString())); txpow.setBlockNumber(new MiniNumber(EXECUTION_BLOCK.toString()));
        for (int level = 0; level < GlobalParams.MINIMA_CASCADE_LEVELS; level++) txpow.setSuperParent(level, MiniData.ZERO_TXPOWID);
        txpow.setMMRRoot(syntheticRoot.getData()); txpow.setMMRTotal(syntheticRoot.getValue()); txpow.setHeaderBodyHash(); txpow.calculateTXPOWID();
        System.out.println("{");
        System.out.println("\"mode\":\"" + mode + "\",\"action\":\"" + actionName + "\",\"actionCode\":" + action + ",");
        System.out.println("\"recordHex\":\"" + new MiniData(record).to0xString().toLowerCase() + "\",");
        System.out.println("\"covenantAddress\":\"" + address.to0xString().toLowerCase() + "\",\"bridgeTokenId\":\"" + bridge.getTokenID().to0xString().toLowerCase() + "\",\"controlTokenId\":\"" + control.getTokenID().to0xString().toLowerCase() + "\",");
        System.out.println("\"committeeRoot\":\"" + committeeRoot.to0xString().toLowerCase() + "\",\"authorityPublicKey\":\"" + authority.getPublicKey().to0xString().toLowerCase() + "\",");
        System.out.println("\"scriptBytes\":" + script.getBytes(StandardCharsets.UTF_8).length + ",\"transactionValid\":" + tx.checkValid() + ",");
        System.out.println("\"inputCount\":" + tx.getAllInputs().size() + ",\"outputCount\":" + tx.getAllOutputs().size() + ",\"signatureCount\":" + witness.getAllSignatures().size() + ",\"coinProofCount\":" + witness.getAllCoinProofs().size() + ",\"scriptProofCount\":" + witness.getAllScripts().size() + ",");
        System.out.println("\"transactionBytes\":" + serializedBytes(tx) + ",\"witnessBytes\":" + serializedBytes(witness) + ",\"serializedTxPowBytes\":" + serializedBytes(txpow) + ",\"coinProofDepth\":32,");
        System.out.println("\"controlPassed\":" + (controlContract.isSuccess() && !controlContract.isException()) + ",\"reservePassed\":" + (reserveContract.isSuccess() && !reserveContract.isException()) + ",\"ownerPassed\":" + ownerPassed + ",");
        System.out.println("\"mutationsRejected\":{\"crossLane\":" + laneRejected + ",\"unsupportedAction\":" + actionRejected + ",\"extraOutput\":" + extraOutputRejected + ",\"accounting\":" + accountingRejected + ",\"authorization\":" + authorizationRejected + ",\"actionSpecific\":" + actionSpecificRejected + ",\"undercollateralizedVault\":" + undercollateralizedVaultRejected + ",\"staleOriginalSignature\":" + staleSignatureRejected + "},");
        System.out.println("\"controlInstructions\":" + controlContract.getNumberOfInstructions() + ",\"reserveInstructions\":" + reserveContract.getNumberOfInstructions() + ",\"ownerInstructions\":" + ownerInstructions + ",");
        System.out.println("\"controlException\":\"" + escape(controlContract.getException()) + "\",\"reserveException\":\"" + escape(reserveContract.getException()) + "\",");
        System.out.println("\"controlFailure\":\"" + failureLine(controlContract) + "\",\"reserveFailure\":\"" + failureLine(reserveContract) + "\",\"ownerFailure\":\"" + ownerFailure + "\",");
        System.out.println("\"returnedInputId\":\"" + (returnedInput == null ? "" : returnedInput.getCoinID().to0xString().toLowerCase()) + "\",\"recordReturnedCoinId\":\"" + (action == 3 ? new MiniData(slice(record,317,32)).to0xString().toLowerCase() : "") + "\"");
        System.out.println("}");
    }
    private static String escape(String value) { return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\""); }
    private static final class ByteArrayOutputStreamLike { private byte[] data = new byte[0]; void write(byte[] value) { byte[] next = new byte[data.length + value.length]; System.arraycopy(data, 0, next, 0, data.length); System.arraycopy(value, 0, next, data.length, value.length); data = next; } byte[] bytes() { return data; } }
}
