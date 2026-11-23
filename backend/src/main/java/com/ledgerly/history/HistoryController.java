package com.ledgerly.history;

import com.ledgerly.auth.UserAccount;
import java.util.List;
import java.util.UUID;
import java.time.Instant;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/history")
public class HistoryController {
    private final HistoryEventRepository history;

    public HistoryController(HistoryEventRepository history) {
        this.history = history;
    }

    @GetMapping
    public List<HistoryResponse> list(@AuthenticationPrincipal UserAccount account) {
        return history.findByUserIdOrderByCreatedAtDesc(account.getId()).stream()
                .map(event -> new HistoryResponse(
                        event.getReceiptId(),
                        event.getEventType(),
                        event.getDescription(),
                        event.getCreatedAt()))
                .toList();
    }

    public record HistoryResponse(UUID receiptId, String eventType, String description, Instant createdAt) {}
}
