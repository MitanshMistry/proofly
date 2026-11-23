package com.ledgerly.history;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HistoryEventRepository extends JpaRepository<HistoryEvent, UUID> {
    List<HistoryEvent> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
