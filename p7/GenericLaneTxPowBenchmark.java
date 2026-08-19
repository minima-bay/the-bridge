import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
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

public final class GenericLaneTxPowBenchmark {
    private static final int RECORD_BYTES = 444;
    private static final BigInteger U64_MAX = BigInteger.ONE.shiftLeft(64).subtract(BigInteger.ONE);
    private static final BigInteger WEI = BigInteger.TEN.pow(18);
    private static final BigInteger USDT_ATOMS = BigInteger.TEN.pow(6);
    private static final BigInteger EXECUTION_BLOCK = new BigInteger("22123500");
    private static final BigInteger ACCEPTED_HEAD_BLOCK = new BigInteger("22123490");
    private static final BigInteger EQUAL_HEAD_WINDOW = new BigInteger("100");

    private static final class Lane {
        final String name;
        final int sourceKind;
        final int decimals;
        final BigInteger factor;
        final BigInteger fixedSupply;
        final BigInteger cap;
        final BigInteger amount;
        final BigInteger priorIssued;
        final BigInteger pending;
        final BigInteger priorVaultBalance;
        final BigInteger nextVaultBalance;
        final String vault;
        final String sourceAsset;
        final String laneId;

        Lane(String mode) {
            if (mode.equals("eth")) {
                name = "native-ethm";
                sourceKind = 0;
                decimals = 18;
                factor = WEI;
                fixedSupply = new BigInteger("11000000000000000000");
                cap = new BigInteger("10000000000000000000");
                amount = new BigInteger("1250000000000000000");
                priorIssued = new BigInteger("1000000000000000000");
                pending = new BigInteger("200000000000000000");
                priorVaultBalance = new BigInteger("4000000000000000000");
                nextVaultBalance = new BigInteger("5000000000000000000");
                vault = repeatHex("cc", 20);
                sourceAsset = repeatHex("00", 20);
                laneId = repeatHex("dd", 32);
            } else if (mode.equals("erc20")) {
                name = "erc20-usdtm";
                sourceKind = 1;
                decimals = 6;
                factor = USDT_ATOMS;
                fixedSupply = new BigInteger("1000001000000");
                cap = new BigInteger("999999999999");
                amount = new BigInteger("1250000");
                priorIssued = new BigInteger("1000000");
                pending = new BigInteger("200000");
                priorVaultBalance = new BigInteger("4000000");
                nextVaultBalance = new BigInteger("5000000");
                vault = repeatHex("22", 20);
                sourceAsset = repeatHex("33", 20);
                laneId = repeatHex("44", 32);
            } else {
                throw new IllegalArgumentException("mode must be eth or erc20");
            }
            if (cap.compareTo(U64_MAX) > 0 || fixedSupply.compareTo(U64_MAX) > 0) {
                throw new IllegalArgumentException("lane exceeds uint64");
            }
        }
    }

    private static final class Build {
        Lane lane;
        TreeKey[] keys;
        Token bridgeToken;
        Token controlToken;
        String script;
        MiniData address;
        MiniData record;
        MiniData recordDigest;
        Transaction transaction;
        Witness witness;
        TxPoW txpow;
        Coin controlInput;
        Coin reserveInput;
        ArrayList<StateVariable> previousState;
        int controlInstructions;
        int reserveInstructions;
        boolean controlSuccess;
        boolean reserveSuccess;
        String controlError;
        String reserveError;
        String controlFailure;
        boolean signaturesVerified;
        int coinProofDepth;
        boolean equalHead;
    }

    private static String repeatHex(String pair, int bytes) {
        StringBuilder out = new StringBuilder("0x");
        for (int i = 0; i < bytes; i++) out.append(pair);
        return out.toString();
    }

    private static String seedHex(int operator) {
        StringBuilder out = new StringBuilder("0x");
        for (int index = 0; index < 32; index++) out.append(String.format("%02x", (operator * 37 + index) & 0xff));
        return out.toString();
    }

    private static MiniNumber rawAmount(BigInteger atoms) {
        return new MiniNumber(atoms.toString()).mult(MiniNumber.MINI_UNIT);
    }

    private static int serializedBytes(Streamable value) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(bytes);
        value.writeDataStream(output);
        output.flush();
        return bytes.toByteArray().length;
    }

    private static Transaction copyTransaction(Transaction value) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(bytes);
        value.writeDataStream(output);
        output.flush();
        Transaction copy = new Transaction();
        copy.readDataStream(new DataInputStream(new ByteArrayInputStream(bytes.toByteArray())));
        return copy;
    }

    private static MiniData hashText(String value) {
        return new MiniData(Crypto.getInstance().hashData(value.getBytes(StandardCharsets.US_ASCII)));
    }

    private static String sub(int start, int width) {
        return "SUBSET(" + start + " " + (start + width) + " record)";
    }

    private static String numberSub(int start, int width) {
        return "NUMBER(" + sub(start, width) + ")";
    }

    private static String makeScript(Lane lane, Token bridgeToken, Token controlToken, TreeKey[] keys) {
        StringBuilder multisig = new StringBuilder("MULTISIG(5");
        for (TreeKey key : keys) multisig.append(" ").append(key.getPublicKey().to0xString());
        multisig.append(")");

        String token = bridgeToken.getTokenID().to0xString();
        String control = controlToken.getTokenID().to0xString();
        String network = repeatHex("11", 32);
        StringBuilder script = new StringBuilder();
        script.append("ASSERT @TOTIN EQ 2 ASSERT @TOTOUT EQ 3 ");
        script.append("ASSERT GETINADDR(0) EQ @ADDRESS ASSERT GETINADDR(1) EQ @ADDRESS ");
        script.append("ASSERT GETINTOK(0) EQ ").append(control).append(" ASSERT GETINAMT(0) EQ 1 ");
        script.append("ASSERT GETINTOK(1) EQ ").append(token).append(" ");
        script.append("LET record=STATE(90) ASSERT LEN(record) EQ 444 ");
        script.append("LET amountsource=").append(numberSub(240, 8)).append(" ");
        script.append("LET amountdest=").append(numberSub(248, 8)).append(" ");
        script.append("LET oldreserve=(GETINAMT(1)*").append(lane.factor).append(") ");
        script.append("LET newreserve=STATE(6) ");
        script.append("ASSERT amountdest GT 0 ASSERT amountdest LT oldreserve ");
        script.append("ASSERT oldreserve EQ (newreserve+amountdest) ");
        script.append("ASSERT GETOUTADDR(0) EQ @ADDRESS ASSERT GETOUTTOK(0) EQ ").append(control).append(" ");
        script.append("ASSERT GETOUTAMT(0) EQ 1 ASSERT GETOUTKEEPSTATE(0) EQ TRUE ");
        script.append("ASSERT GETOUTADDR(1) EQ @ADDRESS ASSERT GETOUTTOK(1) EQ ").append(token).append(" ");
        script.append("ASSERT GETOUTKEEPSTATE(1) EQ FALSE ASSERT (GETOUTAMT(1)*").append(lane.factor).append(") EQ newreserve ");
        script.append("ASSERT GETOUTADDR(2) EQ ").append(sub(256, 32)).append(" ASSERT GETOUTTOK(2) EQ ").append(token).append(" ");
        script.append("ASSERT GETOUTKEEPSTATE(2) EQ FALSE ASSERT (GETOUTAMT(2)*").append(lane.factor).append(") EQ amountdest ");
        script.append("IF @INPUT EQ 1 THEN RETURN TRUE ENDIF ASSERT @INPUT EQ 0 ");
        script.append("ASSERT ").append(multisig).append(" ");
        script.append("ASSERT ").append(numberSub(0, 2)).append(" EQ 1 ASSERT ").append(numberSub(2, 1)).append(" EQ 1 ");
        script.append("ASSERT ").append(numberSub(3, 2)).append(" EQ 1 ASSERT ").append(numberSub(5, 1)).append(" EQ PREVSTATE(30) ");
        script.append("ASSERT ").append(numberSub(6, 1)).append(" EQ PREVSTATE(31) ASSERT ").append(numberSub(7, 1)).append(" EQ PREVSTATE(32) ");
        script.append("ASSERT ").append(numberSub(8, 8)).append(" EQ PREVSTATE(38) ASSERT ").append(numberSub(16, 8)).append(" EQ PREVSTATE(39) ");
        script.append("ASSERT ").append(numberSub(24, 8)).append(" EQ PREVSTATE(33) ASSERT ").append(numberSub(32, 8)).append(" EQ PREVSTATE(35) ");
        script.append("ASSERT ").append(sub(40, 32)).append(" EQ PREVSTATE(36) ASSERT ").append(sub(72, 20)).append(" EQ PREVSTATE(12) ");
        script.append("ASSERT ").append(sub(92, 20)).append(" EQ PREVSTATE(34) ASSERT ").append(sub(112, 32)).append(" EQ PREVSTATE(11) ");
        script.append("ASSERT ").append(sub(144, 32)).append(" EQ PREVSTATE(13) ASSERT ").append(sub(176, 32)).append(" EQ @ADDRESS ");
        script.append("ASSERT (amountsource*PREVSTATE(39)) EQ (amountdest*PREVSTATE(38)) ");
        script.append("LET newissued=(PREVSTATE(4)+amountdest) ASSERT STATE(4) EQ newissued ASSERT STATE(5) EQ PREVSTATE(5) ");
        script.append("ASSERT newreserve EQ (PREVSTATE(6)-amountdest) ASSERT PREVSTATE(6) EQ oldreserve ");
        script.append("ASSERT (newreserve+newissued) EQ PREVSTATE(7) ASSERT newissued LTE PREVSTATE(33) ");
        script.append("LET newvault=").append(numberSub(368, 8)).append(" ");
        script.append("ASSERT ((newissued+PREVSTATE(5))*PREVSTATE(38)) LTE (newvault*PREVSTATE(39)) ");
        script.append("LET newversion=").append(numberSub(360, 8)).append(" ");
        script.append("LET newblock=").append(numberSub(288, 8)).append(" ");
        script.append("LET newcursor=").append(numberSub(376, 8)).append(" ASSERT newcursor EQ PREVSTATE(15) ");
        script.append("LET newpaid=").append(numberSub(384, 8)).append(" ASSERT newpaid EQ PREVSTATE(16) ");
        script.append("IF newversion EQ PREVSTATE(25) THEN ");
        script.append("ASSERT newvault EQ PREVSTATE(8) ASSERT newblock EQ PREVSTATE(26) ");
        script.append("ASSERT ").append(sub(296, 32)).append(" EQ PREVSTATE(27) ASSERT STATE(17) EQ PREVSTATE(17) ");
        script.append("ASSERT (@BLOCK-PREVSTATE(17)) LTE PREVSTATE(18) ");
        script.append("ELSE ASSERT newversion EQ (PREVSTATE(25)+1) ASSERT newblock GTE PREVSTATE(26) ");
        script.append("ASSERT STATE(17) GTE PREVSTATE(17) ASSERT STATE(17) LTE @BLOCK ");
        script.append("ASSERT (@BLOCK-STATE(17)) LTE PREVSTATE(18) ENDIF ");
        script.append("ASSERT STATE(8) EQ newvault ASSERT STATE(15) EQ newcursor ASSERT STATE(16) EQ newpaid ");
        script.append("ASSERT STATE(25) EQ newversion ASSERT STATE(26) EQ newblock ASSERT STATE(27) EQ ").append(sub(296, 32)).append(" ");
        script.append("ASSERT ").append(numberSub(392, 4)).append(" EQ PREVSTATE(28) ASSERT ").append(sub(396, 32)).append(" EQ PREVSTATE(29) ");
        script.append("ASSERT ").append(numberSub(428, 8)).append(" EQ PREVSTATE(1) ");
        script.append("LET sourcetime=").append(numberSub(436, 8)).append(" ");
        script.append("ASSERT sourcetime LTE (@BLOCKMILLI+PREVSTATE(24)) ");
        script.append("ASSERT @BLOCKMILLI LTE (sourcetime+PREVSTATE(23)) ");
        script.append("ASSERT STATE(10) EQ SHA3(CONCAT(PREVSTATE(10) ").append(sub(112, 32)).append(" ").append(sub(208, 32)).append(")) ");
        script.append("ASSERT SAMESTATE(0 3) ASSERT SAMESTATE(7 7) ASSERT SAMESTATE(9 9) ASSERT SAMESTATE(18 24) ");
        script.append("ASSERT SAMESTATE(11 14) ASSERT SAMESTATE(28 39) RETURN TRUE");
        return Contract.cleanScript(script.toString());
    }

    private static void writeUInt(byte[] out, int offset, int width, BigInteger value) {
        if (value.signum() < 0 || value.bitLength() > width * 8) throw new IllegalArgumentException("integer overflow");
        byte[] raw = value.toByteArray();
        int source = raw.length > width ? raw.length - width : 0;
        int length = Math.min(raw.length, width);
        System.arraycopy(raw, source, out, offset + width - length, length);
    }

    private static void writeHex(byte[] out, int offset, int width, MiniData value) {
        byte[] raw = value.getBytes();
        if (raw.length != width) throw new IllegalArgumentException("wrong fixed hex width");
        System.arraycopy(raw, 0, out, offset, width);
    }

    private static MiniData makeRecord(Lane lane, Token bridgeToken, MiniData covenant, MiniData recipient, MiniData committeeRoot, boolean equalHead) {
        byte[] out = new byte[RECORD_BYTES];
        writeUInt(out, 0, 2, BigInteger.ONE);
        writeUInt(out, 2, 1, BigInteger.ONE);
        writeUInt(out, 3, 2, BigInteger.ONE);
        writeUInt(out, 5, 1, BigInteger.valueOf(lane.sourceKind));
        writeUInt(out, 6, 1, BigInteger.valueOf(lane.decimals));
        writeUInt(out, 7, 1, BigInteger.valueOf(lane.decimals));
        writeUInt(out, 8, 8, BigInteger.ONE);
        writeUInt(out, 16, 8, BigInteger.ONE);
        writeUInt(out, 24, 8, lane.cap);
        writeUInt(out, 32, 8, BigInteger.ONE);
        writeHex(out, 40, 32, new MiniData(repeatHex("11", 32)));
        writeHex(out, 72, 20, new MiniData(lane.vault));
        writeHex(out, 92, 20, new MiniData(lane.sourceAsset));
        writeHex(out, 112, 32, new MiniData(lane.laneId));
        writeHex(out, 144, 32, bridgeToken.getTokenID());
        writeHex(out, 176, 32, covenant);
        writeHex(out, 208, 32, hashText(lane.name + (equalHead ? "-second-deposit" : "-deposit")));
        writeUInt(out, 240, 8, lane.amount);
        writeUInt(out, 248, 8, lane.amount);
        writeHex(out, 256, 32, recipient);
        writeUInt(out, 288, 8, new BigInteger("22123457"));
        writeHex(out, 296, 32, hashText(lane.name + "-block"));
        writeHex(out, 328, 32, hashText(lane.name + "-record"));
        writeUInt(out, 360, 8, new BigInteger("18"));
        writeUInt(out, 368, 8, lane.nextVaultBalance);
        writeUInt(out, 376, 8, new BigInteger("3"));
        writeUInt(out, 384, 8, lane.sourceKind == 0 ? new BigInteger("200000000000000000") : new BigInteger("200000"));
        writeUInt(out, 392, 4, new BigInteger("9"));
        writeHex(out, 396, 32, committeeRoot);
        writeUInt(out, 428, 8, BigInteger.ONE);
        writeUInt(out, 436, 8, new BigInteger("1700000000000"));
        return new MiniData(out);
    }

    private static BigInteger priorIssued(Lane lane, boolean equalHead) {
        return equalHead ? lane.priorIssued.add(lane.amount) : lane.priorIssued;
    }

    private static ArrayList<StateVariable> previousState(Lane lane, Token bridgeToken, Token controlToken, MiniData committeeRoot, MiniData covenant, boolean equalHead) {
        ArrayList<StateVariable> state = new ArrayList<>();
        BigInteger issued = priorIssued(lane, equalHead);
        state.add(new StateVariable(0, "1"));
        state.add(new StateVariable(1, "1"));
        state.add(new StateVariable(2, hashText(lane.name + "-client").to0xString()));
        state.add(new StateVariable(3, hashText(lane.name + "-bridge").to0xString()));
        state.add(new StateVariable(4, issued.toString()));
        state.add(new StateVariable(5, lane.pending.toString()));
        state.add(new StateVariable(6, lane.fixedSupply.subtract(issued).toString()));
        state.add(new StateVariable(7, lane.fixedSupply.toString()));
        state.add(new StateVariable(8, (equalHead ? lane.nextVaultBalance : lane.priorVaultBalance).toString()));
        state.add(new StateVariable(9, Integer.toString(lane.decimals)));
        state.add(new StateVariable(10, hashText(lane.name + "-nullifier-root").to0xString()));
        state.add(new StateVariable(11, lane.laneId));
        state.add(new StateVariable(12, lane.vault));
        state.add(new StateVariable(13, bridgeToken.getTokenID().to0xString()));
        state.add(new StateVariable(14, controlToken.getTokenID().to0xString()));
        state.add(new StateVariable(15, "3"));
        state.add(new StateVariable(16, lane.sourceKind == 0 ? "200000000000000000" : "200000"));
        state.add(new StateVariable(17, ACCEPTED_HEAD_BLOCK.toString()));
        state.add(new StateVariable(18, EQUAL_HEAD_WINDOW.toString()));
        state.add(new StateVariable(19, hashText(lane.name + "-latest-redemption").to0xString()));
        state.add(new StateVariable(20, repeatHex("aa", 20)));
        state.add(new StateVariable(21, hashText(lane.name + "-latest-returned-coin").to0xString()));
        state.add(new StateVariable(22, lane.sourceKind == 0 ? "500000000000000000" : "500000"));
        state.add(new StateVariable(23, "3600000"));
        state.add(new StateVariable(24, "300000"));
        state.add(new StateVariable(25, equalHead ? "18" : "17"));
        state.add(new StateVariable(26, equalHead ? "22123457" : "22123456"));
        state.add(new StateVariable(27, hashText(lane.name + (equalHead ? "-block" : "-prior-block")).to0xString()));
        state.add(new StateVariable(28, "9"));
        state.add(new StateVariable(29, committeeRoot.to0xString()));
        state.add(new StateVariable(30, Integer.toString(lane.sourceKind)));
        state.add(new StateVariable(31, Integer.toString(lane.decimals)));
        state.add(new StateVariable(32, Integer.toString(lane.decimals)));
        state.add(new StateVariable(33, lane.cap.toString()));
        state.add(new StateVariable(34, lane.sourceAsset));
        state.add(new StateVariable(35, "1"));
        state.add(new StateVariable(36, repeatHex("11", 32)));
        state.add(new StateVariable(37, covenant.to0xString()));
        state.add(new StateVariable(38, "1"));
        state.add(new StateVariable(39, "1"));
        return state;
    }

    private static BigInteger readUInt(byte[] data, int offset, int width) {
        return new BigInteger(1, subset(data, offset, width));
    }

    private static void addSuccessorState(Transaction transaction, ArrayList<StateVariable> prior, Lane lane, MiniData record, boolean equalHead) {
        for (StateVariable variable : prior) transaction.addStateVariable(new StateVariable(variable.getPort(), variable.toString()));
        BigInteger nextIssued = priorIssued(lane, equalHead).add(lane.amount);
        BigInteger nextReserve = lane.fixedSupply.subtract(nextIssued);
        transaction.addStateVariable(new StateVariable(4, nextIssued.toString()));
        transaction.addStateVariable(new StateVariable(6, nextReserve.toString()));
        transaction.addStateVariable(new StateVariable(8, readUInt(record.getBytes(), 368, 8).toString()));
        MiniData nextNullifier = new MiniData(Crypto.getInstance().hashData(concat(
            new MiniData(prior.get(10).toString()).getBytes(),
            new MiniData(lane.laneId).getBytes(),
            subset(record.getBytes(), 208, 32)
        )));
        transaction.addStateVariable(new StateVariable(10, nextNullifier.to0xString()));
        transaction.addStateVariable(new StateVariable(15, readUInt(record.getBytes(), 376, 8).toString()));
        transaction.addStateVariable(new StateVariable(16, readUInt(record.getBytes(), 384, 8).toString()));
        transaction.addStateVariable(new StateVariable(17, equalHead ? ACCEPTED_HEAD_BLOCK.toString() : EXECUTION_BLOCK.subtract(BigInteger.ONE).toString()));
        transaction.addStateVariable(new StateVariable(25, readUInt(record.getBytes(), 360, 8).toString()));
        transaction.addStateVariable(new StateVariable(26, readUInt(record.getBytes(), 288, 8).toString()));
        transaction.addStateVariable(new StateVariable(27, new MiniData(subset(record.getBytes(), 296, 32)).to0xString()));
        transaction.addStateVariable(new StateVariable(90, record.to0xString()));
    }

    private static byte[] subset(byte[] data, int offset, int length) {
        byte[] out = new byte[length];
        System.arraycopy(data, offset, out, 0, length);
        return out;
    }

    private static byte[] concat(byte[]... values) {
        int total = 0;
        for (byte[] value : values) total += value.length;
        byte[] out = new byte[total];
        int cursor = 0;
        for (byte[] value : values) {
            System.arraycopy(value, 0, out, cursor, value.length);
            cursor += value.length;
        }
        return out;
    }

    private static MMRProof[] syntheticProofs(Coin control, Coin reserve, int depth) {
        MMRData controlLeaf = MMRData.CreateMMRDataLeafNode(control, control.getAmount());
        MMRData reserveLeaf = MMRData.CreateMMRDataLeafNode(reserve, reserve.getAmount());
        MMRProof controlProof = new MMRProof(new MiniNumber("22123400"));
        MMRProof reserveProof = new MMRProof(new MiniNumber("22123400"));
        controlProof.addProofChunk(false, reserveLeaf);
        reserveProof.addProofChunk(true, controlLeaf);
        for (int level = 1; level < depth; level++) {
            MMRData sibling = new MMRData(hashText("synthetic-mmr-sibling-" + level), MiniNumber.ZERO);
            controlProof.addProofChunk(false, sibling);
            reserveProof.addProofChunk(false, sibling);
        }
        MMRData rootA = controlProof.calculateProof(controlLeaf);
        MMRData rootB = reserveProof.calculateProof(reserveLeaf);
        if (!rootA.isEqual(rootB)) throw new IllegalStateException("synthetic proofs do not share root");
        return new MMRProof[] { controlProof, reserveProof };
    }

    private static Contract runContract(Build build, Transaction transaction, Witness witness, int input, ArrayList<StateVariable> previous) {
        Contract contract = new Contract(build.script, witness.getAllSignatureKeys(), witness, transaction, previous);
        contract.setGlobals(new MiniNumber("22123500"), new MiniNumber("1700000000000"), transaction, input, new MiniNumber("22123400"), build.script);
        contract.run();
        return contract;
    }

    private static String failureLine(Contract contract) {
        String result = "";
        for (String line : contract.getCompleteTraceLog().split("\\n")) {
            if (line.contains("ASSERT") || line.contains("failed") || line.contains("FAIL")) result = line;
        }
        return result;
    }

    private static Build build(String mode, boolean equalHead) throws Exception {
        Build build = new Build();
        build.lane = new Lane(mode);
        build.equalHead = equalHead;
        build.keys = new TreeKey[7];
        ByteArrayOutputStream committeeBytes = new ByteArrayOutputStream();
        for (int index = 0; index < build.keys.length; index++) {
            build.keys[index] = TreeKey.createDefault(new MiniData(seedHex(index + 1)));
            committeeBytes.write(build.keys[index].getPublicKey().getBytes());
        }
        MiniData committeeRoot = new MiniData(Crypto.getInstance().hashData(committeeBytes.toByteArray()));

        BigInteger rawFixed = build.lane.fixedSupply;
        build.bridgeToken = new Token(hashText(build.lane.name + "-token-coin"), new MiniNumber(44 - build.lane.decimals), rawAmount(rawFixed), new MiniString(build.lane.name), new MiniString("RETURN TRUE"));
        build.controlToken = new Token(hashText(build.lane.name + "-control-coin"), new MiniNumber(44), rawAmount(BigInteger.ONE), new MiniString(build.lane.name + "-control"), new MiniString("RETURN TRUE"));
        build.script = makeScript(build.lane, build.bridgeToken, build.controlToken, build.keys);
        build.address = new Address(build.script).getAddressData();
        MiniData recipient = Address.TRUE_ADDRESS.getAddressData();
        build.record = makeRecord(build.lane, build.bridgeToken, build.address, recipient, committeeRoot, equalHead);
        byte[] domainHash = Crypto.getInstance().hashData("BRIDGE_LANE_ATTESTATION_V1".getBytes(StandardCharsets.US_ASCII));
        build.recordDigest = new MiniData(Crypto.getInstance().hashData(concat(domainHash, build.record.getBytes())));
        build.previousState = previousState(build.lane, build.bridgeToken, build.controlToken, committeeRoot, build.address, equalHead);

        MiniData controlCoinId = hashText(build.lane.name + "-control-input");
        MiniData reserveCoinId = hashText(build.lane.name + "-reserve-input");
        BigInteger oldReserve = build.lane.fixedSupply.subtract(priorIssued(build.lane, equalHead));
        build.controlInput = new Coin(controlCoinId, build.address, rawAmount(BigInteger.ONE), build.controlToken.getTokenID(), true);
        build.controlInput.setToken(build.controlToken);
        build.controlInput.setState(build.previousState);
        build.controlInput.setBlockCreated(new MiniNumber("22123400"));
        build.reserveInput = new Coin(reserveCoinId, build.address, rawAmount(oldReserve), build.bridgeToken.getTokenID(), false);
        build.reserveInput.setToken(build.bridgeToken);
        build.reserveInput.setBlockCreated(new MiniNumber("22123400"));

        build.transaction = new Transaction();
        build.transaction.addInput(build.controlInput);
        build.transaction.addInput(build.reserveInput);
        BigInteger nextIssued = priorIssued(build.lane, equalHead).add(build.lane.amount);
        BigInteger nextReserve = build.lane.fixedSupply.subtract(nextIssued);
        Coin controlOutput = new Coin(build.address, rawAmount(BigInteger.ONE), build.controlToken.getTokenID(), true);
        controlOutput.setToken(build.controlToken);
        Coin reserveOutput = new Coin(build.address, rawAmount(nextReserve), build.bridgeToken.getTokenID(), false);
        reserveOutput.setToken(build.bridgeToken);
        Coin payoutOutput = new Coin(recipient, rawAmount(build.lane.amount), build.bridgeToken.getTokenID(), false);
        payoutOutput.setToken(build.bridgeToken);
        build.transaction.addOutput(controlOutput);
        build.transaction.addOutput(reserveOutput);
        build.transaction.addOutput(payoutOutput);
        addSuccessorState(build.transaction, build.previousState, build.lane, build.record, equalHead);
        TxPoWGenerator.precomputeTransactionCoinID(build.transaction);
        build.transaction.calculateTransactionID();

        build.witness = new Witness();
        build.signaturesVerified = true;
        for (int index = 0; index < 5; index++) {
            Signature signature = build.keys[index].sign(build.transaction.getTransactionID());
            build.signaturesVerified = build.signaturesVerified && build.keys[index].verify(build.transaction.getTransactionID(), signature);
            build.witness.addSignature(signature);
        }
        build.coinProofDepth = 32;
        MMRProof[] proofs = syntheticProofs(build.controlInput, build.reserveInput, build.coinProofDepth);
        build.witness.addCoinProof(new CoinProof(build.controlInput, proofs[0]));
        build.witness.addCoinProof(new CoinProof(build.reserveInput, proofs[1]));
        build.witness.addScript(new ScriptProof(build.script));

        Contract control = runContract(build, build.transaction, build.witness, 0, build.previousState);
        Contract reserve = runContract(build, build.transaction, build.witness, 1, new ArrayList<StateVariable>());
        build.controlSuccess = control.isSuccess() && !control.isException();
        build.reserveSuccess = reserve.isSuccess() && !reserve.isException();
        build.controlError = control.isException() ? control.getException() : "";
        build.reserveError = reserve.isException() ? reserve.getException() : "";
        build.controlFailure = build.controlSuccess ? "" : failureLine(control);
        build.controlInstructions = control.getNumberOfInstructions();
        build.reserveInstructions = reserve.getNumberOfInstructions();

        MMRData syntheticRoot = proofs[0].calculateProof(MMRData.CreateMMRDataLeafNode(build.controlInput, build.controlInput.getAmount()));
        build.txpow = new TxPoW();
        build.txpow.setTransaction(build.transaction);
        build.txpow.setWitness(build.witness);
        build.txpow.setTxDifficulty(Crypto.MAX_HASH);
        build.txpow.setBlockDifficulty(Crypto.MAX_HASH);
        build.txpow.setNonce(new MiniNumber("256"));
        build.txpow.setTimeMilli(new MiniNumber("1700000000000"));
        build.txpow.setBlockNumber(new MiniNumber("22123500"));
        for (int level = 0; level < GlobalParams.MINIMA_CASCADE_LEVELS; level++) build.txpow.setSuperParent(level, MiniData.ZERO_TXPOWID);
        build.txpow.setMMRRoot(syntheticRoot.getData());
        build.txpow.setMMRTotal(syntheticRoot.getValue());
        build.txpow.setHeaderBodyHash();
        build.txpow.calculateTXPOWID();
        return build;
    }

    private static boolean mutationRejected(Build build, String kind) throws Exception {
        Transaction mutated = copyTransaction(build.transaction);
        Witness witness = new Witness();
        for (CoinProof proof : build.witness.getAllCoinProofs()) witness.addCoinProof(proof);
        for (ScriptProof proof : build.witness.getAllScripts()) witness.addScript(proof);

        if (kind.equals("recipient")) {
            Coin changed = new Coin(hashText("wrong-recipient"), rawAmount(build.lane.amount), build.bridgeToken.getTokenID(), false);
            changed.setToken(build.bridgeToken);
            mutated.getAllOutputs().set(2, changed);
        }
        if (kind.equals("amount")) mutated.addStateVariable(new StateVariable(4, priorIssued(build.lane, build.equalHead).add(build.lane.amount).add(BigInteger.ONE).toString()));
        if (kind.equals("lane")) {
            byte[] changed = build.record.getBytes().clone();
            changed[112] ^= 1;
            mutated.addStateVariable(new StateVariable(90, new MiniData(changed).to0xString()));
        }
        if (kind.equals("reservefloor")) mutated.addStateVariable(new StateVariable(6, "0"));
        if (kind.equals("payoutcursor")) {
            byte[] changed = build.record.getBytes().clone();
            writeUInt(changed, 376, 8, new BigInteger("4"));
            mutated.addStateVariable(new StateVariable(15, "4"));
            mutated.addStateVariable(new StateVariable(90, new MiniData(changed).to0xString()));
        }
        if (kind.equals("payoutpaid")) {
            byte[] changed = build.record.getBytes().clone();
            BigInteger paid = build.lane.sourceKind == 0 ? new BigInteger("400000000000000000") : new BigInteger("400000");
            writeUInt(changed, 384, 8, paid);
            mutated.addStateVariable(new StateVariable(16, paid.toString()));
            mutated.addStateVariable(new StateVariable(90, new MiniData(changed).to0xString()));
        }
        if (kind.equals("equalheadbalance")) {
            byte[] changed = build.record.getBytes().clone();
            writeUInt(changed, 368, 8, build.lane.nextVaultBalance.add(BigInteger.ONE));
            mutated.addStateVariable(new StateVariable(8, build.lane.nextVaultBalance.add(BigInteger.ONE).toString()));
            mutated.addStateVariable(new StateVariable(90, new MiniData(changed).to0xString()));
        }
        if (kind.equals("sourcefuture") || kind.equals("sourcestale")) {
            byte[] changed = build.record.getBytes().clone();
            BigInteger time = kind.equals("sourcefuture")
                ? new BigInteger("1700000300001") : new BigInteger("1699996399999");
            writeUInt(changed, 436, 8, time);
            mutated.addStateVariable(new StateVariable(90, new MiniData(changed).to0xString()));
        }
        TxPoWGenerator.precomputeTransactionCoinID(mutated);
        mutated.calculateTransactionID();
        if (kind.equals("quorum")) {
            for (int index = 0; index < 4; index++) witness.addSignature(build.witness.getAllSignatures().get(index));
        } else {
            for (int index = 0; index < 5; index++) witness.addSignature(build.keys[index].sign(mutated.getTransactionID()));
        }
        boolean cryptographic = true;
        for (int index = 0; index < witness.getAllSignatures().size(); index++) {
            cryptographic = cryptographic && build.keys[index].verify(mutated.getTransactionID(), witness.getAllSignatures().get(index));
        }
        Contract control = runContract(build, mutated, witness, 0, build.previousState);
        return !cryptographic || !control.isSuccess() || control.isException();
    }

    private static ArrayList<StateVariable> previousWithAcceptedBlock(Build build, BigInteger acceptedBlock) {
        ArrayList<StateVariable> changed = new ArrayList<>();
        for (StateVariable variable : build.previousState) {
            changed.add(new StateVariable(variable.getPort(), variable.getPort() == 17 ? acceptedBlock.toString() : variable.toString()));
        }
        return changed;
    }

    private static boolean acceptedBlockTransitionAccepted(Build build, BigInteger previousAcceptedBlock, BigInteger successorAcceptedBlock) throws Exception {
        Transaction changed = copyTransaction(build.transaction);
        changed.addStateVariable(new StateVariable(17, successorAcceptedBlock.toString()));
        TxPoWGenerator.precomputeTransactionCoinID(changed);
        changed.calculateTransactionID();
        Witness fresh = new Witness();
        for (int index = 0; index < 5; index++) fresh.addSignature(build.keys[index].sign(changed.getTransactionID()));
        for (int index = 0; index < 5; index++) {
            if (!build.keys[index].verify(changed.getTransactionID(), fresh.getAllSignatures().get(index))) return false;
        }
        Contract control = runContract(build, changed, fresh, 0, previousWithAcceptedBlock(build, previousAcceptedBlock));
        return control.isSuccess() && !control.isException();
    }

    private static boolean staleSignaturesRejected(Build build) throws Exception {
        Transaction changed = copyTransaction(build.transaction);
        Coin wrong = new Coin(hashText("stale-signature-recipient"), rawAmount(build.lane.amount), build.bridgeToken.getTokenID(), false);
        wrong.setToken(build.bridgeToken);
        changed.getAllOutputs().set(2, wrong);
        TxPoWGenerator.precomputeTransactionCoinID(changed);
        changed.calculateTransactionID();
        for (int index = 0; index < 5; index++) {
            if (build.keys[index].verify(changed.getTransactionID(), build.witness.getAllSignatures().get(index))) return false;
        }
        return true;
    }

    private static boolean structuralMutationRejected(Build build, String kind) throws Exception {
        Transaction changed = copyTransaction(build.transaction);
        if (kind.equals("extraOutput")) {
            Coin extra = new Coin(Address.TRUE_ADDRESS.getAddressData(), rawAmount(BigInteger.ONE), build.bridgeToken.getTokenID(), false);
            extra.setToken(build.bridgeToken);
            changed.addOutput(extra);
        } else if (kind.equals("extraInput")) {
            changed.addInput(build.reserveInput);
        } else {
            int output = kind.startsWith("control") ? 0 : kind.startsWith("reserve") ? 1 : 2;
            Coin original = changed.getAllOutputs().get(output);
            MiniData address = original.getAddress();
            MiniNumber amount = original.getAmount();
            MiniData token = original.getTokenID();
            boolean keep = original.storeState();
            if (kind.endsWith("Address")) address = hashText("wrong-" + kind);
            if (kind.endsWith("Amount")) amount = amount.add(MiniNumber.MINI_UNIT);
            if (kind.endsWith("Token")) token = output == 0 ? build.bridgeToken.getTokenID() : build.controlToken.getTokenID();
            if (kind.endsWith("KeepState")) keep = !keep;
            Coin replacement = new Coin(address, amount, token, keep);
            replacement.setToken(token.isEqual(build.bridgeToken.getTokenID()) ? build.bridgeToken : build.controlToken);
            changed.getAllOutputs().set(output, replacement);
        }
        TxPoWGenerator.precomputeTransactionCoinID(changed);
        changed.calculateTransactionID();
        Witness fresh = new Witness();
        for (int index = 0; index < 5; index++) fresh.addSignature(build.keys[index].sign(changed.getTransactionID()));
        Contract control = runContract(build, changed, fresh, 0, build.previousState);
        boolean verified = true;
        for (int index = 0; index < 5; index++) verified &= build.keys[index].verify(changed.getTransactionID(), fresh.getAllSignatures().get(index));
        return verified && (!control.isSuccess() || control.isException());
    }

    private static boolean statePortMutationRejected(Build build, int port) throws Exception {
        Transaction changed = copyTransaction(build.transaction);
        String value = port == 19 || port == 21 ? hashText("wrong-state-port-" + port).to0xString()
            : port == 20 ? repeatHex("bb", 20) : "999999999";
        changed.addStateVariable(new StateVariable(port, value));
        TxPoWGenerator.precomputeTransactionCoinID(changed);
        changed.calculateTransactionID();
        Witness fresh = new Witness();
        for (int index = 0; index < 5; index++) fresh.addSignature(build.keys[index].sign(changed.getTransactionID()));
        boolean verified = true;
        for (int index = 0; index < 5; index++) verified &= build.keys[index].verify(changed.getTransactionID(), fresh.getAllSignatures().get(index));
        Contract control = runContract(build, changed, fresh, 0, build.previousState);
        return verified && (!control.isSuccess() || control.isException());
    }

    private static boolean equalHeadHashMutationRejected(Build build) throws Exception {
        Transaction changed = copyTransaction(build.transaction);
        byte[] record = build.record.getBytes().clone();
        record[296] ^= 1;
        changed.addStateVariable(new StateVariable(27, new MiniData(subset(record, 296, 32)).to0xString()));
        changed.addStateVariable(new StateVariable(90, new MiniData(record).to0xString()));
        TxPoWGenerator.precomputeTransactionCoinID(changed);
        changed.calculateTransactionID();
        Contract control = runContract(build, changed, build.witness, 0, build.previousState);
        return !control.isSuccess() || control.isException();
    }

    private static int staleRecordFieldMutationsRejected(Build build) throws Exception {
        int[] offsets = {0,2,3,5,6,7,8,16,24,32,40,72,92,112,144,176,208,240,248,256,288,296,328,360,368,376,384,392,396,428,436};
        int rejected = 0;
        for (int offset : offsets) {
            Transaction changed = copyTransaction(build.transaction);
            byte[] record = build.record.getBytes().clone();
            record[offset] ^= 1;
            changed.addStateVariable(new StateVariable(90, new MiniData(record).to0xString()));
            TxPoWGenerator.precomputeTransactionCoinID(changed);
            changed.calculateTransactionID();
            boolean allInvalid = true;
            for (int index = 0; index < 5; index++) allInvalid &= !build.keys[index].verify(changed.getTransactionID(), build.witness.getAllSignatures().get(index));
            if (allInvalid) rejected++;
        }
        return rejected;
    }

    private static String recordFieldsJson(MiniData record) {
        String[] names = {"schemaVersion","direction","laneVersion","sourceAssetKind","sourceDecimals","destinationDecimals","sourceQuantumAtoms","destinationQuantumAtoms","laneExposureCapDestinationAtoms","ethereumChainId","minimaNetwork","ethereumVault","sourceAsset","laneId","destinationTokenId","reserveCovenant","depositId","amountSourceAtoms","amountDestinationAtoms","minimaRecipient","finalizedBlockNumber","finalizedBlockHash","sourceRecordHash","vaultStateVersion","vaultBalanceSourceAtoms","vaultPayoutCursor","vaultCumulativePaidSourceAtoms","committeeEpoch","committeeRoot","configurationEpoch","sourceExecutionTimeMilliseconds"};
        int[] offsets = {0,2,3,5,6,7,8,16,24,32,40,72,92,112,144,176,208,240,248,256,288,296,328,360,368,376,384,392,396,428,436};
        int[] widths = {2,1,2,1,1,1,8,8,8,8,32,20,20,32,32,32,32,8,8,32,8,32,32,8,8,8,8,4,32,8,8};
        boolean[] hex = {false,false,false,false,false,false,false,false,false,false,true,true,true,true,true,true,true,false,false,true,false,true,true,false,false,false,false,false,true,false,false};
        StringBuilder json = new StringBuilder("{");
        for (int index = 0; index < names.length; index++) {
            if (index > 0) json.append(",");
            json.append("\"").append(names[index]).append("\":\"");
            if (hex[index]) json.append(new MiniData(subset(record.getBytes(), offsets[index], widths[index])).to0xString().toLowerCase());
            else json.append(readUInt(record.getBytes(), offsets[index], widths[index]).toString());
            json.append("\"");
        }
        return json.append("}").toString();
    }

    public static void main(String[] args) throws Exception {
        String mode = args.length == 0 ? "eth" : args[0];
        Build build = build(mode, false);
        Build equalHead = build(mode, true);
        boolean valid = build.transaction.checkValid();
        boolean quorumRejected = mutationRejected(build, "quorum");
        boolean recipientRejected = mutationRejected(build, "recipient");
        boolean amountRejected = mutationRejected(build, "amount");
        boolean laneRejected = mutationRejected(build, "lane");
        boolean reserveFloorRejected = mutationRejected(build, "reservefloor");
        boolean payoutCursorRejected = mutationRejected(build, "payoutcursor");
        boolean payoutPaidRejected = mutationRejected(build, "payoutpaid");
        boolean equalHeadBalanceRejected = mutationRejected(equalHead, "equalheadbalance");
        boolean sourceFutureRejected = mutationRejected(build, "sourcefuture");
        boolean sourceStaleRejected = mutationRejected(build, "sourcestale");
        boolean acceptedLagZeroAccepted = acceptedBlockTransitionAccepted(build, ACCEPTED_HEAD_BLOCK, EXECUTION_BLOCK);
        boolean acceptedLagOneAccepted = acceptedBlockTransitionAccepted(build, ACCEPTED_HEAD_BLOCK, EXECUTION_BLOCK.subtract(BigInteger.ONE));
        boolean acceptedMonotonicBoundaryAccepted = acceptedBlockTransitionAccepted(build, ACCEPTED_HEAD_BLOCK, ACCEPTED_HEAD_BLOCK);
        boolean acceptedPostingLagBoundaryAccepted = acceptedBlockTransitionAccepted(build,
            EXECUTION_BLOCK.subtract(EQUAL_HEAD_WINDOW), EXECUTION_BLOCK.subtract(EQUAL_HEAD_WINDOW));
        boolean acceptedFutureRejected = !acceptedBlockTransitionAccepted(build, ACCEPTED_HEAD_BLOCK, EXECUTION_BLOCK.add(BigInteger.ONE));
        boolean acceptedRollbackRejected = !acceptedBlockTransitionAccepted(build, ACCEPTED_HEAD_BLOCK, ACCEPTED_HEAD_BLOCK.subtract(BigInteger.ONE));
        boolean acceptedStaleRejected = !acceptedBlockTransitionAccepted(build,
            EXECUTION_BLOCK.subtract(EQUAL_HEAD_WINDOW).subtract(BigInteger.valueOf(2)),
            EXECUTION_BLOCK.subtract(EQUAL_HEAD_WINDOW).subtract(BigInteger.ONE));
        boolean staleSignatures = staleSignaturesRejected(build);
        int staleRecordFields = staleRecordFieldMutationsRejected(build);
        String[] structuralKinds = {"extraInput","extraOutput","controlAddress","controlAmount","controlToken","controlKeepState","reserveAddress","reserveAmount","reserveToken","reserveKeepState","payoutAddress","payoutAmount","payoutToken","payoutKeepState"};
        int structuralRejected = 0;
        for (String kind : structuralKinds) if (structuralMutationRejected(build, kind)) structuralRejected++;
        boolean equalHeadHashRejected = equalHeadHashMutationRejected(equalHead);
        int preservedStatePortsRejected = 0;
        for (int port = 19; port <= 24; port++) if (statePortMutationRejected(build, port)) preservedStatePortsRejected++;
        int transactionBytes = serializedBytes(build.transaction);
        int witnessBytes = serializedBytes(build.witness);
        int txpowBytes = serializedBytes(build.txpow);
        int scriptProofBytes = serializedBytes(new ScriptProof(build.script));
        int signaturesBytes = 0;
        for (Signature signature : build.witness.getAllSignatures()) signaturesBytes += serializedBytes(signature);

        System.out.println("{");
        System.out.println("  \"schema\": \"generic-lane-txpow-benchmark/v1\",");
        System.out.println("  \"lane\": \"" + build.lane.name + "\",");
        System.out.println("  \"recordBytes\": " + build.record.getLength() + ",");
        System.out.println("  \"recordHex\": \"" + build.record.to0xString().toLowerCase() + "\",");
        System.out.println("  \"recordDigest\": \"" + build.recordDigest.to0xString().toLowerCase() + "\",");
        System.out.println("  \"recordFields\": " + recordFieldsJson(build.record) + ",");
        System.out.println("  \"covenantAddress\": \"" + build.address.to0xString().toLowerCase() + "\",");
        System.out.println("  \"bridgeTokenId\": \"" + build.bridgeToken.getTokenID().to0xString().toLowerCase() + "\",");
        System.out.println("  \"controlTokenId\": \"" + build.controlToken.getTokenID().to0xString().toLowerCase() + "\",");
        System.out.println("  \"scriptBytes\": " + build.script.getBytes(StandardCharsets.UTF_8).length + ",");
        System.out.println("  \"scriptProofBytes\": " + scriptProofBytes + ",");
        System.out.println("  \"transactionBytes\": " + transactionBytes + ",");
        System.out.println("  \"witnessBytes\": " + witnessBytes + ",");
        System.out.println("  \"fiveSignatureBytes\": " + signaturesBytes + ",");
        System.out.println("  \"coinProofDepth\": " + build.coinProofDepth + ",");
        System.out.println("  \"serializedTxPowBytes\": " + txpowBytes + ",");
        System.out.println("  \"controlInstructions\": " + build.controlInstructions + ",");
        System.out.println("  \"reserveInstructions\": " + build.reserveInstructions + ",");
        System.out.println("  \"controlScriptPassed\": " + build.controlSuccess + ",");
        System.out.println("  \"reserveScriptPassed\": " + build.reserveSuccess + ",");
        System.out.println("  \"controlError\": \"" + build.controlError.replace("\\", "\\\\").replace("\"", "\\\"") + "\",");
        System.out.println("  \"reserveError\": \"" + build.reserveError.replace("\\", "\\\\").replace("\"", "\\\"") + "\",");
        System.out.println("  \"controlFailure\": \"" + build.controlFailure.replace("\\", "\\\\").replace("\"", "\\\"") + "\",");
        System.out.println("  \"signaturesVerified\": " + build.signaturesVerified + ",");
        System.out.println("  \"transactionAmountsValid\": " + valid + ",");
        System.out.println("  \"equalHeadControlPassed\": " + equalHead.controlSuccess + ",");
        System.out.println("  \"equalHeadReservePassed\": " + equalHead.reserveSuccess + ",");
        System.out.println("  \"equalHeadSignaturesVerified\": " + equalHead.signaturesVerified + ",");
        System.out.println("  \"equalHeadTransactionAmountsValid\": " + equalHead.transaction.checkValid() + ",");
        System.out.println("  \"equalHeadControlInstructions\": " + equalHead.controlInstructions + ",");
        System.out.println("  \"equalHeadSerializedTxPowBytes\": " + serializedBytes(equalHead.txpow) + ",");
        System.out.println("  \"staleOriginalSignaturesRejected\": " + staleSignatures + ",");
        System.out.println("  \"staleSignatureRecordFieldMutationsRejected\": " + staleRecordFields + ",");
        System.out.println("  \"authorizedStructuralMutationsRejected\": " + structuralRejected + ",");
        System.out.println("  \"authorizedStructuralMutationCount\": " + structuralKinds.length + ",");
        System.out.println("  \"freshlySignedPreservedStatePortsRejected\": " + preservedStatePortsRejected + ",");
        System.out.println("  \"acceptedHeadBlockBoundaries\": {");
        System.out.println("    \"zeroLagAccepted\": " + acceptedLagZeroAccepted + ",");
        System.out.println("    \"oneBlockLagAccepted\": " + acceptedLagOneAccepted + ",");
        System.out.println("    \"monotonicBoundaryAccepted\": " + acceptedMonotonicBoundaryAccepted + ",");
        System.out.println("    \"postingLagBoundaryAccepted\": " + acceptedPostingLagBoundaryAccepted);
        System.out.println("  },");
        System.out.println("  \"mutationsRejected\": {");
        System.out.println("    \"fourOfSeven\": " + quorumRejected + ",");
        System.out.println("    \"recipientOrTransactionId\": " + recipientRejected + ",");
        System.out.println("    \"successorAmount\": " + amountRejected + ",");
        System.out.println("    \"crossLaneRecord\": " + laneRejected + ",");
        System.out.println("    \"reserveFloor\": " + reserveFloorRejected + ",");
        System.out.println("    \"payoutCursorAdvanceWithoutAck\": " + payoutCursorRejected + ",");
        System.out.println("    \"payoutCumulativeAdvanceWithoutAck\": " + payoutPaidRejected + ",");
        System.out.println("    \"equalHeadChangedBalance\": " + equalHeadBalanceRejected + ",");
        System.out.println("    \"equalHeadChangedBlockHash\": " + equalHeadHashRejected + ",");
        System.out.println("    \"sourceTimeBeyondFutureSkew\": " + sourceFutureRejected + ",");
        System.out.println("    \"sourceTimeBeyondMaximumAge\": " + sourceStaleRejected + ",");
        System.out.println("    \"acceptedHeadBlockInFuture\": " + acceptedFutureRejected + ",");
        System.out.println("    \"acceptedHeadBlockRollback\": " + acceptedRollbackRejected + ",");
        System.out.println("    \"acceptedHeadBlockBeyondPostingLag\": " + acceptedStaleRejected);
        System.out.println("  }");
        System.out.println("}");
    }
}
