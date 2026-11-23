package com.ledgerly.document;

import com.ledgerly.auth.UserAccount;
import com.ledgerly.receipt.Receipt;
import com.ledgerly.receipt.ReceiptRepository;
import com.ledgerly.storage.LocalReceiptStorage;
import com.ledgerly.storage.StoredFile;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import com.ledgerly.history.HistoryEvent;
import com.ledgerly.history.HistoryEventRepository;

@RestController
@RequestMapping("/api/purchases")
public class PurchaseDocumentController {
    private final ReceiptRepository receipts;
    private final PurchaseDocumentRepository documents;
    private final LocalReceiptStorage storage;
    private final HistoryEventRepository history;

    public PurchaseDocumentController(ReceiptRepository receipts, PurchaseDocumentRepository documents,
                                      LocalReceiptStorage storage, HistoryEventRepository history) {
        this.receipts = receipts;
        this.documents = documents;
        this.storage = storage;
        this.history = history;
    }

    @GetMapping("/{receiptId}/documents")
    public List<DocumentResponse> list(@AuthenticationPrincipal UserAccount account,
                                       @PathVariable UUID receiptId) {
        Receipt receipt = ownedReceipt(account, receiptId);
        return documents.findByReceiptId(receipt.getId()).stream().map(DocumentResponse::from).toList();
    }

    @PostMapping("/{receiptId}/documents")
    public DocumentResponse upload(@AuthenticationPrincipal UserAccount account,
                                   @PathVariable UUID receiptId,
                                   @RequestParam("file") MultipartFile file,
                                   @RequestParam(value = "documentType", defaultValue = "SUPPORTING") String documentType) {
        Receipt receipt = ownedReceipt(account, receiptId);
        StoredFile stored = null;
        try {
            stored = storage.store(file);
            PurchaseDocument document = documents.save(new PurchaseDocument(
                    receipt.getId(), stored.objectKey(), stored.mimeType(), documentType,
                    stored.sizeBytes(), stored.sha256()));
            history.save(new HistoryEvent(account.getId(), receipt.getId(), "DOCUMENT_UPLOADED",
                    documentType + " document uploaded"));
            return DocumentResponse.from(document);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage());
        } catch (RuntimeException exception) {
            if (stored != null) storage.delete(stored.objectKey());
            throw exception;
        }
    }

    @GetMapping("/{receiptId}/documents/{documentId}")
    public ResponseEntity<byte[]> download(@AuthenticationPrincipal UserAccount account,
                                           @PathVariable UUID receiptId,
                                           @PathVariable UUID documentId) {
        ownedReceipt(account, receiptId);
        PurchaseDocument document = documents.findById(documentId)
                .filter(item -> item.getReceiptId().equals(receiptId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        try {
            MediaType mediaType = MediaType.parseMediaType(document.getMimeType());
            return ResponseEntity.ok().contentType(mediaType).body(storage.read(document.getObjectKey()));
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found");
        } catch (RuntimeException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found");
        }
    }

    @DeleteMapping("/{receiptId}/documents/{documentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal UserAccount account,
                       @PathVariable UUID receiptId,
                       @PathVariable UUID documentId) {
        ownedReceipt(account, receiptId);
        PurchaseDocument document = documents.findById(documentId)
                .filter(item -> item.getReceiptId().equals(receiptId))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Document not found"));
        documents.delete(document);
        storage.delete(document.getObjectKey());
        history.save(new HistoryEvent(account.getId(), receiptId, "DOCUMENT_DELETED",
                document.getDocumentType() + " document deleted"));
    }

    private Receipt ownedReceipt(UserAccount account, UUID receiptId) {
        return receipts.findById(receiptId)
                .filter(receipt -> receipt.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Purchase not found"));
    }

    public record DocumentResponse(UUID id, String documentType, String mimeType, Long sizeBytes) {
        static DocumentResponse from(PurchaseDocument document) {
            return new DocumentResponse(document.getId(), document.getDocumentType(),
                    document.getMimeType(), document.getSizeBytes());
        }
    }
}
