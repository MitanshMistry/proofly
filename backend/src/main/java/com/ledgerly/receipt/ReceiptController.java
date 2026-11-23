package com.ledgerly.receipt;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import com.ledgerly.auth.UserAccount;
import com.ledgerly.storage.LocalReceiptStorage;
import com.ledgerly.storage.StoredFile;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import jakarta.servlet.http.HttpServletResponse;
import java.io.PrintWriter;
import com.ledgerly.project.ProjectRepository;
import java.io.IOException;
import java.time.format.DateTimeParseException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestParam;
import com.ledgerly.document.PurchaseDocumentRepository;
import com.ledgerly.history.HistoryEvent;
import com.ledgerly.history.HistoryEventRepository;

@RestController
@RequestMapping("/api/receipts")
public class ReceiptController {
    private final ReceiptRepository repository;
    private final LocalReceiptStorage storage;
    private final ProjectRepository projects;
    private final PurchaseDocumentRepository purchaseDocuments;
    private final HistoryEventRepository history;

    public ReceiptController(ReceiptRepository repository, LocalReceiptStorage storage, ProjectRepository projects,
                             PurchaseDocumentRepository purchaseDocuments, HistoryEventRepository history) {
        this.repository = repository;
        this.storage = storage;
        this.projects = projects;
        this.purchaseDocuments = purchaseDocuments;
        this.history = history;
    }

    @GetMapping
    public List<ReceiptResponse> list(@AuthenticationPrincipal UserAccount account,
                                      @RequestParam(value = "q", required = false) String query,
                                      @RequestParam(value = "status", required = false) String status,
                                      @RequestParam(value = "sort", defaultValue = "newest") String sort) {
        var purchases = repository.findByUserIdOrderByPurchasedAtDesc(account.getId()).stream()
                .filter(receipt -> query == null || query.isBlank()
                        || java.util.stream.Stream.of(
                                receipt.getNotes(), receipt.getReceiptNumber(), receipt.getProductName(),
                                receipt.getBrand(), receipt.getModelNumber(), receipt.getSerialNumber(),
                                receipt.getSku(), receipt.getCategory())
                        .filter(java.util.Objects::nonNull)
                        .anyMatch(value -> value.toLowerCase().contains(query.toLowerCase())))
                .filter(receipt -> status == null || status.isBlank() || "ALL".equalsIgnoreCase(status)
                        || receipt.getWarrantyStatus().equalsIgnoreCase(status))
                .toList();
        if ("oldest".equalsIgnoreCase(sort)) {
            purchases = purchases.stream().sorted((left, right) -> {
                if (left.getPurchasedAt() == null) return right.getPurchasedAt() == null ? 0 : 1;
                if (right.getPurchasedAt() == null) return -1;
                return left.getPurchasedAt().compareTo(right.getPurchasedAt());
            }).toList();
        } else if ("warranty".equalsIgnoreCase(sort)) {
            purchases = purchases.stream().sorted((left, right) -> {
                if (left.getWarrantyEndAt() == null) return right.getWarrantyEndAt() == null ? 0 : 1;
                if (right.getWarrantyEndAt() == null) return -1;
                return left.getWarrantyEndAt().compareTo(right.getWarrantyEndAt());
            }).toList();
        }
        return purchases.stream().map(ReceiptResponse::from).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ReceiptResponse create(@AuthenticationPrincipal UserAccount account, @Valid @RequestBody CreateReceiptRequest request) {
        Receipt receipt = new Receipt(account.getId(), request.purchasedAt(), request.total(), request.merchantName(), request.category());
        receipt.setPurchaseAndWarrantyDetails(request.receiptNumber(), request.productName(), request.brand(),
                request.modelNumber(), request.serialNumber(), request.sku(), null, "UNKNOWN",
                null, null, null, null, false);
        Receipt saved = repository.save(receipt);
        history.save(new HistoryEvent(account.getId(), saved.getId(), "RECEIPT_CREATED",
                "Purchase created for " + saved.getNotes()));
        return ReceiptResponse.from(saved);
    }

    @PostMapping(value = "/upload", consumes = "multipart/form-data")
    @ResponseStatus(HttpStatus.CREATED)
    public ReceiptResponse upload(
            @AuthenticationPrincipal UserAccount account,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "merchantName", required = false) String merchantName,
            @RequestParam(value = "purchasedAt", required = false) String purchasedAt,
            @RequestParam(value = "total", required = false) BigDecimal total,
            @RequestParam(value = "category", defaultValue = "Shopping") String category,
            @RequestParam(value = "receiptNumber", required = false) String receiptNumber,
            @RequestParam(value = "modelNumber", required = false) String modelNumber,
            @RequestParam(value = "serialNumber", required = false) String serialNumber) {
        final StoredFile stored;
        try {
            stored = storage.store(file);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage());
        }
        LocalDate purchaseDate;
        try {
            purchaseDate = purchasedAt == null || purchasedAt.isBlank() ? null : LocalDate.parse(purchasedAt);
        } catch (DateTimeParseException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Purchase date is invalid");
        }
        String merchant = merchantName == null || merchantName.isBlank() ? "Needs review" : merchantName.trim();
        BigDecimal receiptTotal = total == null ? BigDecimal.ZERO : total;
        Receipt receipt = new Receipt(account.getId(), purchaseDate, receiptTotal, merchant, category);
        receipt.setImageMetadata(stored.objectKey(), stored.mimeType(), stored.sizeBytes(), stored.sha256());
        receipt.setPurchaseAndWarrantyDetails(receiptNumber, null, null, modelNumber,
                serialNumber, null, null, "UNKNOWN", null, null, null, null, false);
        Receipt saved = repository.save(receipt);
        history.save(new HistoryEvent(account.getId(), saved.getId(), "RECEIPT_UPLOADED",
                "Purchase evidence uploaded for " + saved.getNotes()));
        return ReceiptResponse.from(saved);
    }

    @GetMapping("/{receiptId}")
    public ReceiptResponse detail(@AuthenticationPrincipal UserAccount account, @PathVariable UUID receiptId) {
        Receipt receipt = repository.findById(receiptId)
                .filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        return ReceiptResponse.from(receipt);
    }

    @PatchMapping("/{receiptId}")
    public ReceiptResponse update(@AuthenticationPrincipal UserAccount account, @PathVariable UUID receiptId,
                                  @Valid @RequestBody UpdateReceiptRequest request) {
        Receipt receipt = repository.findById(receiptId)
                .filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        UUID projectId = request.projectId();
        if (projectId != null && projects.findById(projectId).filter(project -> project.getUserId().equals(account.getId())).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found");
        }
        receipt.update(request.purchasedAt(), request.total(), request.merchantName().trim(), request.category(), projectId);
        receipt.setPurchaseAndWarrantyDetails(
                request.receiptNumber(), request.productName(), request.brand(), request.modelNumber(),
                request.serialNumber(), request.sku(), request.quantity(), request.warrantyProvider(),
                request.warrantyDurationMonths(), request.warrantyStartAt(), request.warrantyEndAt(),
                request.returnWindowEndAt(), request.warrantyConfirmed());
        Receipt saved = repository.save(receipt);
        history.save(new HistoryEvent(account.getId(), saved.getId(), "RECEIPT_UPDATED",
                "Purchase updated for " + saved.getNotes()));
        return ReceiptResponse.from(saved);
    }

    @DeleteMapping("/{receiptId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal UserAccount account, @PathVariable UUID receiptId) {
        Receipt receipt = repository.findById(receiptId)
                .filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        purchaseDocuments.findByReceiptId(receiptId).forEach(document -> {
            purchaseDocuments.delete(document);
            storage.delete(document.getObjectKey());
        });
        history.save(new HistoryEvent(account.getId(), receipt.getId(), "RECEIPT_DELETED",
                "Purchase deleted for " + (receipt.getNotes() == null ? "Needs review" : receipt.getNotes())));
        repository.delete(receipt);
        storage.delete(receipt.getImageObjectKey());
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAll(@AuthenticationPrincipal UserAccount account) {
        var ownedReceipts = repository.findByUserIdOrderByPurchasedAtDesc(account.getId());
        ownedReceipts.forEach(receipt -> purchaseDocuments.findByReceiptId(receipt.getId()).forEach(document -> {
            purchaseDocuments.delete(document);
            storage.delete(document.getObjectKey());
        }));
        ownedReceipts.forEach(receipt -> history.save(new HistoryEvent(account.getId(), receipt.getId(),
                "RECEIPT_DELETED", "Purchase deleted for " +
                (receipt.getNotes() == null ? "Needs review" : receipt.getNotes()))));
        ownedReceipts.forEach(receipt -> storage.delete(receipt.getImageObjectKey()));
        ownedReceipts.forEach(repository::delete);
    }

    @GetMapping("/{receiptId}/image")
    public ResponseEntity<byte[]> image(@AuthenticationPrincipal UserAccount account, @PathVariable UUID receiptId) {
        Receipt receipt = repository.findById(receiptId)
                .filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        if (receipt.getImageObjectKey() == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt image not found");
        }
        try {
            MediaType mediaType = receipt.getImageMimeType() == null
                    ? MediaType.APPLICATION_OCTET_STREAM
                    : MediaType.parseMediaType(receipt.getImageMimeType());
            return ResponseEntity.ok().contentType(mediaType).body(storage.read(receipt.getImageObjectKey()));
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt image not found");
        }
    }

    @GetMapping("/{receiptId}/duplicates")
    public List<DuplicateResponse> duplicates(@AuthenticationPrincipal UserAccount account, @PathVariable UUID receiptId) {
        Receipt source = repository.findById(receiptId)
                .filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        return repository.findByUserIdOrderByPurchasedAtDesc(account.getId()).stream()
                .filter(item -> !item.getId().equals(source.getId()))
                .filter(item -> {
                    boolean exactImage = source.getImageSha256() != null
                            && !source.getImageSha256().isBlank()
                            && source.getImageSha256().equals(item.getImageSha256());
                    boolean exactSerial = source.getSerialNumber() != null
                            && !source.getSerialNumber().isBlank()
                            && source.getSerialNumber().equalsIgnoreCase(item.getSerialNumber());
                    boolean exactReceiptNumber = source.getReceiptNumber() != null
                            && !source.getReceiptNumber().isBlank()
                            && source.getReceiptNumber().equalsIgnoreCase(item.getReceiptNumber());
                    boolean exactPurchase = source.getPurchasedAt() != null
                            && source.getPurchasedAt().equals(item.getPurchasedAt())
                            && source.getNotes() != null
                            && source.getNotes().equalsIgnoreCase(item.getNotes())
                            && source.getTotal() != null
                            && item.getTotal() != null
                            && source.getTotal().compareTo(item.getTotal()) == 0;
                    return exactImage || exactSerial || exactReceiptNumber || exactPurchase;
                })
                .map(item -> new DuplicateResponse(item.getId(), "Matches a serial number, receipt number, or exact purchase"))
                .toList();
    }

    @GetMapping("/export.csv")
    public void exportCsv(@AuthenticationPrincipal UserAccount account, HttpServletResponse response) throws Exception {
        response.setContentType("text/csv");
        response.setHeader("Content-Disposition", "attachment; filename=\"ledgerly-receipts.csv\"");
        try (PrintWriter writer = response.getWriter()) {
            writer.println("Merchant,Purchase date,Amount,Category,Status");
            for (Receipt receipt : repository.findByUserIdOrderByPurchasedAtDesc(account.getId())) {
                writer.printf("%s,%s,%s,%s,%s%n",
                        csv(receipt.getNotes()), csv(receipt.getPurchasedAt()),
                        receipt.getTotal(), csv(receipt.getCategory()), csv(receipt.getStatus()));
            }
        }
    }

    private String csv(Object value) {
        if (value == null) return "";
        return "\"" + String.valueOf(value).replace("\"", "\"\"") + "\"";
    }

    public record CreateReceiptRequest(@NotBlank String merchantName, @NotNull LocalDate purchasedAt,
                                       @NotNull @DecimalMin("0.00") BigDecimal total, @NotBlank String category,
                                       String receiptNumber, String productName, String brand,
                                       String modelNumber, String serialNumber, String sku) {}

    public record ReceiptResponse(UUID id, String merchantName, LocalDate purchasedAt, BigDecimal total,
                                  String category, UUID projectId, String status, String receiptNumber,
                                  String productName, String brand, String modelNumber, String serialNumber,
                                  String sku, Integer quantity, String warrantyProvider,
                                  Integer warrantyDurationMonths, LocalDate warrantyStartAt,
                                  LocalDate warrantyEndAt, LocalDate returnWindowEndAt,
                                  Boolean warrantyConfirmed, String warrantyStatus) {
        static ReceiptResponse from(Receipt receipt) {
            return new ReceiptResponse(receipt.getId(), receipt.getNotes(), receipt.getPurchasedAt(),
                    receipt.getTotal(), receipt.getCategory(), receipt.getProjectId(), receipt.getStatus(),
                    receipt.getReceiptNumber(), receipt.getProductName(), receipt.getBrand(),
                    receipt.getModelNumber(), receipt.getSerialNumber(), receipt.getSku(), receipt.getQuantity(),
                    receipt.getWarrantyProvider(), receipt.getWarrantyDurationMonths(),
                    receipt.getWarrantyStartAt(), receipt.getWarrantyEndAt(), receipt.getReturnWindowEndAt(),
                    receipt.getWarrantyConfirmed(), receipt.getWarrantyStatus());
        }
    }
    public record DuplicateResponse(UUID receiptId, String reason) {}
    public record UpdateReceiptRequest(@NotBlank String merchantName, @NotNull LocalDate purchasedAt,
                                       @NotNull @DecimalMin("0.00") BigDecimal total,
                                       @NotBlank String category, UUID projectId,
                                       String receiptNumber, String productName, String brand,
                                       String modelNumber, String serialNumber, String sku,
                                       Integer quantity, String warrantyProvider,
                                       Integer warrantyDurationMonths, LocalDate warrantyStartAt,
                                       LocalDate warrantyEndAt, LocalDate returnWindowEndAt,
                                       boolean warrantyConfirmed) {}
}
