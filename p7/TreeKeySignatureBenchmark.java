import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;

import org.minima.objects.base.MiniData;
import org.minima.objects.keys.Signature;
import org.minima.objects.keys.TreeKey;

public final class TreeKeySignatureBenchmark {
    private static int serializedBytes(Signature signature) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(bytes);
        signature.writeDataStream(output);
        output.flush();
        return bytes.toByteArray().length;
    }

    private static String seedHex(int operator) {
        StringBuilder out = new StringBuilder("0x");
        for (int index = 0; index < 32; index++) {
            out.append(String.format("%02x", (operator * 37 + index) & 0xff));
        }
        return out.toString();
    }

    public static void main(String[] args) throws Exception {
        MiniData recordDigest = new MiniData(
            "0x7f58b7887b9d7d3272537219022b3f4dd6e42d79bf7fb9662e0574895d802540"
        );
        int totalBytes = 0;
        int minimumBytes = Integer.MAX_VALUE;
        int maximumBytes = 0;
        boolean allVerified = true;
        int proofLevels = -1;

        for (int operator = 1; operator <= 5; operator++) {
            TreeKey key = TreeKey.createDefault(new MiniData(seedHex(operator)));
            Signature signature = key.sign(recordDigest);
            int signatureBytes = serializedBytes(signature);
            totalBytes += signatureBytes;
            minimumBytes = Math.min(minimumBytes, signatureBytes);
            maximumBytes = Math.max(maximumBytes, signatureBytes);
            allVerified = allVerified && key.verify(recordDigest, signature);
            proofLevels = signature.getAllSignatureProofs().size();
        }

        System.out.println("{");
        System.out.println("  \"schema\": \"minima-treekey-signature-benchmark/v1\",");
        System.out.println("  \"keyConfiguration\": \"TreeKey.createDefault(64,3)\",");
        System.out.println("  \"operators\": 5,");
        System.out.println("  \"proofLevelsPerSignature\": " + proofLevels + ",");
        System.out.println("  \"publicKeyBytes\": 32,");
        System.out.println("  \"minimumSerializedSignatureBytes\": " + minimumBytes + ",");
        System.out.println("  \"maximumSerializedSignatureBytes\": " + maximumBytes + ",");
        System.out.println("  \"fiveSerializedSignaturesBytes\": " + totalBytes + ",");
        System.out.println("  \"allSignaturesVerified\": " + allVerified);
        System.out.println("}");
    }
}
