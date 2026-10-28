import Foundation
import Security

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: keychain-helper get|put|delete service\n".utf8))
    exit(64)
}

let operation = arguments[1]
let service = arguments[2]
guard service.hasPrefix("fr.velov.personal-api.") else {
    exit(64)
}

let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: "lyon",
]

var status: OSStatus
switch operation {
case "put":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty, data.count <= 131_072 else {
        exit(65)
    }
    status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrLabel as String] = "Vélo'v, session personnelle"
        attributes[kSecAttrSynchronizable as String] = false
        status = SecItemAdd(attributes as CFDictionary, nil)
    }
case "get":
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    status = SecItemCopyMatching(search as CFDictionary, &item)
    if status == errSecItemNotFound {
        exit(44)
    }
    if status == errSecSuccess, let data = item as? Data {
        FileHandle.standardOutput.write(data)
    } else if status == errSecSuccess {
        exit(65)
    }
case "delete":
    status = SecItemDelete(query as CFDictionary)
    if status == errSecItemNotFound {
        status = errSecSuccess
    }
default:
    exit(64)
}

guard status == errSecSuccess else {
    FileHandle.standardError.write(Data("keychain_status=\(status)\n".utf8))
    exit(70)
}
