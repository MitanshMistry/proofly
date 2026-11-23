package com.ledgerly.project;

import com.ledgerly.auth.UserAccount;
import com.ledgerly.receipt.Receipt;
import com.ledgerly.receipt.ReceiptRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.ledgerly.history.HistoryEvent;
import com.ledgerly.history.HistoryEventRepository;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final ProjectRepository projects;
    private final ReceiptRepository receipts;
    private final HistoryEventRepository history;

    public ProjectController(ProjectRepository projects, ReceiptRepository receipts, HistoryEventRepository history) {
        this.projects = projects;
        this.receipts = receipts;
        this.history = history;
    }

    @GetMapping
    public List<ProjectResponse> list(@AuthenticationPrincipal UserAccount account) {
        return projects.findByUserIdOrderByCreatedAtDesc(account.getId()).stream().map(project -> {
            var assigned = receipts.findByUserIdOrderByPurchasedAtDesc(account.getId()).stream()
                    .filter(receipt -> project.getId().equals(receipt.getProjectId())).toList();
            return ProjectResponse.from(project, assigned);
        }).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse create(@AuthenticationPrincipal UserAccount account, @Valid @RequestBody CreateProjectRequest request) {
        Project project = projects.save(new Project(account.getId(), request.name().trim(), request.color()));
        return ProjectResponse.from(project, List.of());
    }

    @PatchMapping("/{projectId}/receipts/{receiptId}")
    public ProjectResponse assign(@AuthenticationPrincipal UserAccount account,
                                  @PathVariable UUID projectId, @PathVariable UUID receiptId) {
        Project project = projects.findById(projectId).filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        Receipt receipt = receipts.findById(receiptId).filter(item -> item.getUserId().equals(account.getId()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Receipt not found"));
        receipt.setProjectId(project.getId());
        receipts.save(receipt);
        history.save(new HistoryEvent(account.getId(), receipt.getId(), "COLLECTION_ASSIGNED",
                "Purchase assigned to collection " + project.getName()));
        var assigned = receipts.findByUserIdOrderByPurchasedAtDesc(account.getId()).stream()
                .filter(item -> project.getId().equals(item.getProjectId())).toList();
        return ProjectResponse.from(project, assigned);
    }

    public record CreateProjectRequest(@NotBlank String name, String color) {}
    public record ProjectResponse(UUID id, String name, String color, int receiptCount, java.math.BigDecimal total) {
        static ProjectResponse from(Project project, List<Receipt> receipts) {
            java.math.BigDecimal total = receipts.stream().map(Receipt::getTotal)
                    .filter(java.util.Objects::nonNull).reduce(java.math.BigDecimal.ZERO, java.math.BigDecimal::add);
            return new ProjectResponse(project.getId(), project.getName(), project.getColor(), receipts.size(), total);
        }
    }
}
