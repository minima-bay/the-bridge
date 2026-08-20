import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

public final class VerifyMinimaWalletPassword {
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Expected one exact node directory.");
        Path node = Path.of(args[0]).toAbsolutePath().normalize();
        Path passwordFile = node.resolve("dbpassword.local.txt");
        Path wallet = node.resolve("data/1.1/databases/walletsql/wallet");
        String password = Files.readString(passwordFile).trim();
        if (password.isEmpty()) throw new IllegalStateException("Database password file is empty.");
        String url = "jdbc:h2:" + wallet + ";MODE=MySQL;DB_CLOSE_ON_EXIT=FALSE;CIPHER=AES";
        Class.forName("org.h2.Driver");
        try (Connection connection = DriverManager.getConnection(url, "SA", password + " userpasswd");
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES")) {
            if (!result.next() || result.getInt(1) <= 0) throw new IllegalStateException("Wallet schema is empty.");
            System.out.println("{\"walletOpened\":true,\"schemaTables\":" + result.getInt(1)
                + ",\"passwordPrinted\":false}");
        }
    }
}
